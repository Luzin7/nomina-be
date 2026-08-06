import { TransactionStatus, TransactionType } from '@constants/enums';
import { RedisService } from '@infra/cache/redis/RedisService';
import { AnyAccount } from '@modules/account/entities/types';
import { AccountRepository } from '@modules/account/repositories/contracts/AccountRepository';
import { CategoryRepository } from '@modules/category/repositories/contracts/CategoryRepository';
import { Transaction } from '@modules/transaction/entities/Transaction';
import { TransactionRepository } from '@modules/transaction/repositories/contracts/TransactionRepository';
import { Injectable } from '@nestjs/common';
import { TokenPayloadBase } from '@providers/auth/strategys/jwtStrategy';
import { Service } from '@shared/core/contracts/Service';
import { Either, left, right } from '@shared/core/errors/Either';

import { CategoryNotFoundError } from '@modules/category/errors';
import { DestinationAccountRequiredForTransferError } from '@modules/transaction/errors';
import { DateProvider } from '@providers/date/contracts/DateProvider';
import { UnauthorizedError } from '@shared/errors/UnauthorizedError';
import { CreateTransactionRequest } from './create-transaction.dto';

type Request = CreateTransactionRequest & TokenPayloadBase;

@Injectable()
export class CreateTransactionService implements Service<
  Request,
  Error,
  Transaction
> {
  constructor(
    private readonly accountRepository: AccountRepository,
    private readonly categoryRepository: CategoryRepository,
    private readonly transactionRepository: TransactionRepository,
    private readonly dateProvider: DateProvider,
    private readonly redisService: RedisService,
  ) {}

  async execute(request: Request): Promise<Either<Error, Transaction>> {
    const accountsResult = await this.validateAndFetchAccounts(request);
    if (accountsResult.isLeft()) return left(accountsResult.value);
    const { account, destinationAccount } = accountsResult.value;

    const categoryResult = await this.validateCategory(
      request.workspaceId,
      request.categoryId,
    );
    if (categoryResult.isLeft()) return left(categoryResult.value);

    const { transactionDate, resolvedStatus } = this.resolveDateAndStatus(
      request.date,
      request.status,
      account.timezone,
    );

    const transactionOrError = Transaction.create({
      workspaceId: request.workspaceId,
      accountId: request.accountId,
      categoryId: request.categoryId ?? null,
      destinationAccountId: request.destinationAccountId ?? null,
      title: request.title,
      description: request.description ?? null,
      amount: request.amount,
      date: transactionDate,
      type: request.type,
      status: resolvedStatus,
      recurringId: null,
    });
    if (transactionOrError.isLeft()) return left(transactionOrError.value);
    const transaction = transactionOrError.value;

    if (resolvedStatus === TransactionStatus.COMPLETED) {
      const mutationResult = this.applyFinancialMutations(
        account,
        destinationAccount,
        request.type,
        request.amount,
      );
      if (mutationResult.isLeft()) return left(mutationResult.value);
    }

    await this.persistTransaction(
      transaction,
      account,
      destinationAccount,
      request.type,
    );

    await this.redisService.delByPattern(`report:*:${request.workspaceId}:*`);

    return right(transaction);
  }

  private async validateAndFetchAccounts(
    request: Request,
  ): Promise<
    Either<
      Error,
      { account: AnyAccount; destinationAccount: AnyAccount | null }
    >
  > {
    const account = await this.accountRepository.findById(request.accountId);
    if (account?.workspaceId !== request.workspaceId) {
      return left(new UnauthorizedError('Conta origem inválida.'));
    }

    let destinationAccount: AnyAccount | null = null;
    if (request.type === 'TRANSFER') {
      if (!request.destinationAccountId)
        return left(new DestinationAccountRequiredForTransferError());

      destinationAccount = await this.accountRepository.findById(
        request.destinationAccountId,
      );
      if (destinationAccount?.workspaceId !== request.workspaceId) {
        return left(new UnauthorizedError('Conta destino inválida.'));
      }
    }

    return right({ account, destinationAccount });
  }

  private async validateCategory(
    workspaceId: string,
    categoryId: string,
  ): Promise<Either<Error, void>> {
    const category = await this.categoryRepository.findById(categoryId);
    if (!category) return left(new CategoryNotFoundError());

    if (category.workspaceId && category.workspaceId !== workspaceId) {
      return left(
        new UnauthorizedError('Categoria não pertence ao workspace.'),
      );
    }

    return right(undefined);
  }

  private resolveDateAndStatus(
    date: string,
    status: TransactionStatus | undefined,
    timezone: string,
  ): { transactionDate: Date; resolvedStatus: TransactionStatus } {
    const transactionDate = this.dateProvider.startOfDay(date, timezone);
    const today = this.dateProvider.startOfDay(
      this.dateProvider.now(),
      timezone,
    );

    const resolvedStatus =
      transactionDate > today
        ? TransactionStatus.PENDING
        : (status ?? TransactionStatus.COMPLETED);

    return { transactionDate, resolvedStatus };
  }

  private applyFinancialMutations(
    account: AnyAccount,
    destinationAccount: AnyAccount | null,
    type: TransactionType,
    amount: bigint,
  ): Either<Error, void> {
    if (type === 'EXPENSE') {
      return account.applyExpenseEffect(amount);
    }

    if (type === 'INCOME') {
      return account.applyIncomeEffect(amount);
    }

    if (type === 'TRANSFER' && destinationAccount) {
      const debitResult = account.applyExpenseEffect(amount);
      if (debitResult.isLeft()) return debitResult;

      return destinationAccount.applyIncomeEffect(amount);
    }

    return right(undefined);
  }

  private async persistTransaction(
    transaction: Transaction,
    account: AnyAccount,
    destinationAccount: AnyAccount | null,
    type: TransactionType,
  ): Promise<void> {
    if (type === 'TRANSFER' && destinationAccount) {
      await this.transactionRepository.createWithBalanceUpdate(
        transaction,
        Number(account.balance),
        Number(destinationAccount.balance),
      );
    } else {
      await this.transactionRepository.createWithBalanceUpdate(
        transaction,
        Number(account.balance),
      );
    }
  }
}
