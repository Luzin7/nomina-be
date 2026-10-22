import { CacheProvider } from '@infra/cache/contracts/CacheProvider';
import { Transaction } from '@modules/transaction/entities/Transaction';
import { TransactionRepository } from '@modules/transaction/repositories/contracts/TransactionRepository';
import { Injectable } from '@nestjs/common';
import { TokenPayloadBase } from '@providers/auth/strategys/jwtStrategy';
import { Service } from '@shared/core/contracts/Service';
import { Either, left, right } from '@shared/core/errors/Either';
import { SetTransactionStatusRequest } from './set-transaction-status.dto';

type Request = SetTransactionStatusRequest &
  Pick<TokenPayloadBase, 'workspaceId'> & {
    transactionId: string;
  };

@Injectable()
export class SetTransactionStatusService implements Service<
  Request,
  Error,
  Transaction
> {
  constructor(
    private readonly transactionRepository: TransactionRepository,
    private readonly redisService: CacheProvider,
  ) {}

  async execute(request: Request): Promise<Either<Error, Transaction>> {
    const updated =
      await this.transactionRepository.updateStatusWithBalanceEffect({
        transactionId: request.transactionId,
        workspaceId: request.workspaceId,
        status: request.status,
      });
    if (updated.isLeft()) return left(updated.value);

    await this.redisService.delByPattern(`report:*:${request.workspaceId}:*`);

    return right(updated.value);
  }
}
