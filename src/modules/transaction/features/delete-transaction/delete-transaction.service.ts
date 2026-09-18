import { TransactionStatus } from '@constants/enums';
import { CacheProvider } from '@infra/cache/contracts/CacheProvider';
import { AnyAccount } from '@modules/account/entities/types';
import { AccountNotFoundError } from '@modules/account/errors';
import { AccountRepository } from '@modules/account/repositories/contracts/AccountRepository';
import { Transaction } from '@modules/transaction/entities/Transaction';
import { TransactionNotFoundError } from '@modules/transaction/errors';
import { TransactionRepository } from '@modules/transaction/repositories/contracts/TransactionRepository';
import { Injectable } from '@nestjs/common';
import { TokenPayloadBase } from '@providers/auth/strategys/jwtStrategy';
import { Service } from '@shared/core/contracts/Service';
import { Either, left, right } from '@shared/core/errors/Either';
import { UnauthorizedError } from '@shared/errors/UnauthorizedError';
import { FindTransactionRequest } from '../find-transaction/find-transaction.dto';

type Request = FindTransactionRequest & TokenPayloadBase;

@Injectable()
export class DeleteTransactionService implements Service<Request, Error, void> {
  constructor(
    private readonly transactionRepository: TransactionRepository,
    private readonly accountRepository: AccountRepository,
    private readonly redisService: CacheProvider,
  ) {}

  async execute(request: Request): Promise<Either<Error, void>> {
    const transactionResult = await this.fetchAndValidateTransaction(request);
    if (transactionResult.isLeft()) return left(transactionResult.value);
    const transaction = transactionResult.value;

    const accountsResult = await this.fetchAndValidateAccounts(transaction);
    if (accountsResult.isLeft()) return left(accountsResult.value);
    const { account, destinationAccount } = accountsResult.value;

    if (transaction.status === TransactionStatus.COMPLETED) {
      const mutationResult = this.revertFinancialMutations(
        transaction,
        account,
        destinationAccount,
      );
      if (mutationResult.isLeft()) return left(mutationResult.value);
    }

    await this.persistDeletion(transaction, account, destinationAccount);

    await this.redisService.delByPattern(`report:*:${request.workspaceId}:*`);

    return right(undefined);
  }

  private async fetchAndValidateTransaction(
    request: Request,
  ): Promise<Either<Error, Transaction>> {
    const transaction = await this.transactionRepository.findUniqueById(
      request.transactionId,
    );

    if (!transaction) return left(new TransactionNotFoundError());

    if (transaction.workspaceId !== request.workspaceId) {
      return left(
        new UnauthorizedError('Transação não pertence ao workspace.'),
      );
    }

    return right(transaction);
  }

  private async fetchAndValidateAccounts(
    transaction: Transaction,
  ): Promise<
    Either<
      Error,
      { account: AnyAccount; destinationAccount: AnyAccount | null }
    >
  > {
    const account = await this.accountRepository.findById(
      transaction.accountId,
    );
    if (!account)
      return left(new AccountNotFoundError('Conta origem não encontrada.'));

    let destinationAccount: AnyAccount | null = null;
    if (transaction.type === 'TRANSFER' && transaction.destinationAccountId) {
      destinationAccount = await this.accountRepository.findById(
        transaction.destinationAccountId,
      );
      if (!destinationAccount)
        return left(new AccountNotFoundError('Conta destino não encontrada.'));
    }

    return right({ account, destinationAccount });
  }

  private revertFinancialMutations(
    transaction: Transaction,
    account: AnyAccount,
    destinationAccount: AnyAccount | null,
  ): Either<Error, void> {
    const { type, amount } = transaction;

    if (type === 'EXPENSE') {
      return account.applyIncomeEffect(amount);
    }

    if (type === 'INCOME') {
      return account.applyExpenseEffect(amount);
    }

    if (type === 'TRANSFER' && destinationAccount) {
      const creditSourceResult = account.applyIncomeEffect(amount);
      if (creditSourceResult.isLeft()) return creditSourceResult;

      return destinationAccount.applyExpenseEffect(amount);
    }

    return right(undefined);
  }

  private async persistDeletion(
    transaction: Transaction,
    account: AnyAccount,
    destinationAccount: AnyAccount | null,
  ): Promise<void> {
    if (transaction.type === 'TRANSFER' && destinationAccount) {
      await this.transactionRepository.deleteWithBalanceReversion(
        transaction,
        Number(account.balance),
        Number(destinationAccount.balance),
      );
    } else {
      await this.transactionRepository.deleteWithBalanceReversion(
        transaction,
        Number(account.balance),
      );
    }
  }
}
