import { CacheProvider } from '@infra/cache/contracts/CacheProvider';
import {
  AccountNotAdjustableError,
  AccountNotFoundError,
  BalanceChangedSinceReadError,
  IdempotencyKeyReusedError,
} from '@modules/account/errors';
import {
  AccountRepository,
  AdjustBalanceOutcome,
  BalanceAdjustmentRecord,
} from '@modules/account/repositories/contracts/AccountRepository';
import { invalidateGoalReads } from '@modules/goal/services/goal-cache';
import { Injectable, Logger } from '@nestjs/common';
import { TokenPayloadBase } from '@providers/auth/strategys/jwtStrategy';
import { invalidateLedgerReads } from '@shared/cache/report-cache';
import { Service } from '@shared/core/contracts/Service';
import { Either, left, right } from '@shared/core/errors/Either';
import { UnauthorizedError } from '@shared/errors/UnauthorizedError';
import { AdjustAccountBalanceRequest } from './adjust-account-balance.dto';

type Request = AdjustAccountBalanceRequest &
  TokenPayloadBase & { accountId: string };

export type AdjustAccountBalanceResponse = {
  adjusted: boolean;
  adjustment: BalanceAdjustmentRecord | null;
};

const OPERATION = 'adjust-account-balance';

@Injectable()
export class AdjustAccountBalanceService implements Service<
  Request,
  Error,
  AdjustAccountBalanceResponse
> {
  private readonly logger = new Logger(AdjustAccountBalanceService.name);

  constructor(
    private readonly accountRepository: AccountRepository,
    private readonly cacheProvider: CacheProvider,
  ) {}

  async execute(
    request: Request,
  ): Promise<Either<Error, AdjustAccountBalanceResponse>> {
    const { accountId, workspaceId } = request;

    const account = await this.accountRepository.findById(accountId);
    if (!account) return left(new AccountNotFoundError());
    if (account.workspaceId !== workspaceId) {
      return left(new UnauthorizedError());
    }
    if (!account.canAdjustBalance()) {
      return left(new AccountNotAdjustableError());
    }

    const outcome = await this.accountRepository.adjustBalance({
      id: request.id,
      accountId,
      workspaceId,
      actorId: request.sub,
      expectedBalanceCents: request.expectedBalanceCents,
      targetBalanceCents: request.targetBalanceCents,
    });

    return this.respondTo(outcome, request);
  }

  private async respondTo(
    outcome: AdjustBalanceOutcome,
    request: Request,
  ): Promise<Either<Error, AdjustAccountBalanceResponse>> {
    switch (outcome.status) {
      case 'account-not-found':
        return left(new AccountNotFoundError());
      case 'key-reused':
        return left(new IdempotencyKeyReusedError());
      case 'balance-changed':
        return left(new BalanceChangedSinceReadError());
      case 'unchanged':
        return right({ adjusted: false, adjustment: null });
      case 'applied':
      case 'replayed':
        await this.invalidateReads(request.workspaceId);
        this.logger.log(
          `${outcome.status} adjustment ${outcome.adjustment.id} account ${request.accountId} seq ${outcome.adjustment.movementSeq}`,
        );
        return right({ adjusted: true, adjustment: outcome.adjustment });
    }
  }

  private async invalidateReads(workspaceId: string): Promise<void> {
    await invalidateLedgerReads(this.cacheProvider, workspaceId, OPERATION);
    await invalidateGoalReads(this.cacheProvider, workspaceId, OPERATION);
  }
}
