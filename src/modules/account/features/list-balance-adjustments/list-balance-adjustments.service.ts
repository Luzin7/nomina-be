import { AccountNotFoundError } from '@modules/account/errors';
import {
  AccountRepository,
  BalanceAdjustmentRecord,
} from '@modules/account/repositories/contracts/AccountRepository';
import { Injectable } from '@nestjs/common';
import { TokenPayloadBase } from '@providers/auth/strategys/jwtStrategy';
import { Service } from '@shared/core/contracts/Service';
import { Either, left, right } from '@shared/core/errors/Either';
import { UnauthorizedError } from '@shared/errors/UnauthorizedError';

type Request = Pick<TokenPayloadBase, 'workspaceId'> & { accountId: string };

const HISTORY_LIMIT = 20;

@Injectable()
export class ListBalanceAdjustmentsService implements Service<
  Request,
  Error,
  BalanceAdjustmentRecord[]
> {
  constructor(private readonly accountRepository: AccountRepository) {}

  async execute({
    accountId,
    workspaceId,
  }: Request): Promise<Either<Error, BalanceAdjustmentRecord[]>> {
    const account = await this.accountRepository.findById(accountId);
    if (!account) return left(new AccountNotFoundError());
    if (account.workspaceId !== workspaceId) {
      return left(new UnauthorizedError());
    }

    return right(
      await this.accountRepository.listBalanceAdjustments(
        accountId,
        workspaceId,
        HISTORY_LIMIT,
      ),
    );
  }
}
