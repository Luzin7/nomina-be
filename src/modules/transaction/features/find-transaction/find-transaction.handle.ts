import { Transaction } from '@modules/transaction/entities/Transaction';
import { TransactionNotFoundError } from '@modules/transaction/errors';
import { TransactionRepository } from '@modules/transaction/repositories/contracts/TransactionRepository';
import { Injectable } from '@nestjs/common';
import { TokenPayloadSchema } from '@providers/auth/strategys/jwtStrategy';
import { Service } from '@shared/core/contracts/Service';
import { Either, left, right } from '@shared/core/errors/Either';
import { UnauthorizedError } from '@shared/errors/UnauthorizedError';
import { FindTransactionRequest } from './find-transaction.dto';

type Request = FindTransactionRequest & Pick<TokenPayloadSchema, 'workspaceId'>;

@Injectable()
export class FindTransactionByIdService implements Service<
  Request,
  Error,
  Transaction
> {
  constructor(private readonly transactionRepository: TransactionRepository) {}

  async execute({
    workspaceId,
    transactionId,
  }: Request): Promise<Either<Error, Transaction>> {
    const transaction =
      await this.transactionRepository.findUniqueById(transactionId);

    if (!transaction) {
      return left(new TransactionNotFoundError());
    }

    if (transaction.workspaceId !== workspaceId) {
      return left(
        new UnauthorizedError('Transação não pertence ao workspace.'),
      );
    }

    return right(transaction);
  }
}
