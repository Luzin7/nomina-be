import {
  AccountType,
  TransactionStatus,
  TransactionType,
} from '@constants/enums';
import { RedisService } from '@infra/cache/redis/RedisService';
import { AnyAccount } from '@modules/account/entities/types';
import { AccountRepository } from '@modules/account/repositories/contracts/AccountRepository';
import { SYSTEM_CATEGORY } from '@modules/category/constants/system-categories';
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

    const categoryResult = await this.resolveCategoryId(
      request,
      destinationAccount,
    );
    if (categoryResult.isLeft()) return left(categoryResult.value);
    const categoryId = categoryResult.value;

    const { transactionDate, resolvedStatus } = this.resolveDateAndStatus(
      request.date,
      request.status,
      account.timezone,
    );

    const transactionOrError = Transaction.create({
      workspaceId: request.workspaceId,
      accountId: request.accountId,
      categoryId,
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

  /**
   * Transferência entre contas próprias não é gasto nem receita, então o
   * usuário não escolhe categoria: cai na categoria de sistema, cujo ID é fixo
   * e conhecido em tempo de compilação — não custa uma consulta ao banco. Nos
   * demais tipos a categoria vem do request e é validada contra o workspace.
   */
  private async resolveCategoryId(
    request: Request,
    destinationAccount: AnyAccount | null,
  ): Promise<Either<Error, string>> {
    if (!request.categoryId) {
      const isCreditCardPayment =
        request.type === TransactionType.TRANSFER &&
        destinationAccount?.type === AccountType.CREDIT_CARD;

      return right(
        isCreditCardPayment
          ? SYSTEM_CATEGORY.CREDIT_CARD_PAYMENT.id
          : SYSTEM_CATEGORY.TRANSFER.id,
      );
    }

    const category = await this.categoryRepository.findById(request.categoryId);
    if (!category) return left(new CategoryNotFoundError());

    if (category.workspaceId && category.workspaceId !== request.workspaceId) {
      return left(
        new UnauthorizedError('Categoria não pertence ao workspace.'),
      );
    }

    return right(category.id);
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
