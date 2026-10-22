import { CacheProvider } from '@infra/cache/contracts/CacheProvider';
import { Transaction } from '@modules/transaction/entities/Transaction';
import { TransactionNotFoundError } from '@modules/transaction/errors';
import { TransactionRepository } from '@modules/transaction/repositories/contracts/TransactionRepository';
import { Injectable } from '@nestjs/common';
import { TokenPayloadBase } from '@providers/auth/strategys/jwtStrategy';
import { Service } from '@shared/core/contracts/Service';
import { Either, left, right } from '@shared/core/errors/Either';
import { UnauthorizedError } from '@shared/errors/UnauthorizedError';
import { ToggleTransactionStatusRequest } from './toggle-transaction-status.dto';

type Request = ToggleTransactionStatusRequest &
  Pick<TokenPayloadBase, 'workspaceId'>;

@Injectable()
export class ToggleTransactionStatusService implements Service<
  Request,
  Error,
  Transaction
> {
  constructor(
    private readonly transactionRepository: TransactionRepository,
    private readonly redisService: CacheProvider,
  ) {}

  async execute(request: Request): Promise<Either<Error, Transaction>> {
    const transaction = await this.transactionRepository.findUniqueById(
      request.transactionId,
    );
    if (!transaction) return left(new TransactionNotFoundError());
    if (transaction.workspaceId !== request.workspaceId)
      return left(new UnauthorizedError());

    const toggleResult =
      await this.transactionRepository.toggleStatusWithBalanceEffect(
        transaction.id,
      );
    if (toggleResult.isLeft()) return left(toggleResult.value);

    await this.redisService.delByPattern(`report:*:${request.workspaceId}:*`);

    return right(toggleResult.value);
  }
}
