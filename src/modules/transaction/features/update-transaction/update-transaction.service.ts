import { TransactionStatus } from '@constants/enums';
import { RedisService } from '@infra/cache/redis/RedisService';
import { CreditCard } from '@modules/account/entities/CreditCardAccount';
import { AnyAccount } from '@modules/account/entities/types';
import { AccountRepository } from '@modules/account/repositories/contracts/AccountRepository';
import { SYSTEM_CATEGORY } from '@modules/category/constants/system-categories';
import { CategoryRepository } from '@modules/category/repositories/contracts/CategoryRepository';
import { resolveSystemCategoryId } from '@modules/category/services/resolve-system-category';
import { Transaction } from '@modules/transaction/entities/Transaction';
import {
  SourceAndDestinationAccountMustBeDifferentError,
  TransactionNotFoundError,
} from '@modules/transaction/errors';
import { TransactionRepository } from '@modules/transaction/repositories/contracts/TransactionRepository';
import { Injectable } from '@nestjs/common';
import { TokenPayloadBase } from '@providers/auth/strategys/jwtStrategy';
import { DateProvider } from '@providers/date/contracts/DateProvider';
import { Service } from '@shared/core/contracts/Service';
import { Either, left, right } from '@shared/core/errors/Either';
import { UnauthorizedError } from '@shared/errors/UnauthorizedError';
import { UpdateTransactionRequest } from './update-transaction.dto';

type Request = UpdateTransactionRequest & {
  transactionId: string;
} & TokenPayloadBase;

@Injectable()
export class UpdateTransactionService implements Service<
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
    const currentTx = await this.transactionRepository.findUniqueById(
      request.transactionId,
    );
    if (currentTx?.workspaceId !== request.workspaceId) {
      return left(new TransactionNotFoundError());
    }

    const accountsResult = await this.fetchInvolvedAccounts(currentTx, request);
    if (accountsResult.isLeft()) return left(accountsResult.value);
    const accountsMap = accountsResult.value;

    let categoryId = request.categoryId;

    if (categoryId) {
      const catError = await this.validateCategory(
        categoryId,
        request.workspaceId,
      );
      if (catError) return left(catError);
    } else {
      // Transferência: o backend atribui a categoria de sistema, o usuário não
      // escolhe. Ver create-transaction.service.ts.
      const systemCategory = await resolveSystemCategoryId(
        this.categoryRepository,
        SYSTEM_CATEGORY.TRANSFER,
      );
      if (systemCategory.isLeft()) return left(systemCategory.value);
      categoryId = systemCategory.value;
    }

    const newSourceAccount = accountsMap.get(request.accountId)!;
    const resolvedDate = this.dateProvider.startOfDay(
      request.date,
      newSourceAccount.timezone,
    );
    const today = this.dateProvider.startOfDay(
      this.dateProvider.now(),
      newSourceAccount.timezone,
    );
    const resolvedStatus =
      resolvedDate > today ? TransactionStatus.PENDING : request.status;

    const newTxOrError = Transaction.create(
      {
        ...request,
        workspaceId: request.workspaceId,
        date: resolvedDate,
        status: resolvedStatus,
        destinationAccountId: request.destinationAccountId ?? null,
        categoryId,
        description: request.description ?? null,
        recurringId: currentTx.recurringId,
        createdAt: currentTx.createdAt,
        updatedAt: new Date(),
      },
      currentTx.id,
    );

    if (newTxOrError.isLeft()) return left(newTxOrError.value);
    const newTx = newTxOrError.value;

    const revertResult = this.revertMutations(currentTx, accountsMap);
    if (revertResult.isLeft()) return left(revertResult.value);

    const applyResult = this.applyMutations(newTx, accountsMap);
    if (applyResult.isLeft()) return left(applyResult.value);

    await this.persistChanges(currentTx, newTx, accountsMap);

    await this.redisService.delByPattern(`report:*:${request.workspaceId}:*`);

    return right(newTx);
  }

  private async fetchInvolvedAccounts(
    oldTx: Transaction,
    request: Request,
  ): Promise<Either<Error, Map<string, AnyAccount>>> {
    const accountIds = new Set([oldTx.accountId, request.accountId]);
    if (oldTx.destinationAccountId) accountIds.add(oldTx.destinationAccountId);
    if (request.type === 'TRANSFER' && request.destinationAccountId)
      accountIds.add(request.destinationAccountId);

    const accountsMap = new Map<string, AnyAccount>();

    for (const id of accountIds) {
      const account = await this.accountRepository.findById(id);
      if (account?.workspaceId !== request.workspaceId) {
        return left(new UnauthorizedError(`Conta inválida ou acesso negado.`));
      }
      accountsMap.set(id, account);
    }

    if (
      request.type === 'TRANSFER' &&
      request.accountId === request.destinationAccountId
    ) {
      return left(new SourceAndDestinationAccountMustBeDifferentError());
    }

    return right(accountsMap);
  }

  private async validateCategory(
    categoryId: string,
    workspaceId: string,
  ): Promise<Error | null> {
    const category = await this.categoryRepository.findById(categoryId);
    const isGlobal = !category?.workspaceId;
    if (!category || (!isGlobal && category.workspaceId !== workspaceId)) {
      return new UnauthorizedError('Categoria inválida.');
    }
    return null;
  }

  private revertMutations(
    tx: Transaction,
    accounts: Map<string, AnyAccount>,
  ): Either<Error, void> {
    if (tx.status !== TransactionStatus.COMPLETED) return right(undefined);

    const acc = accounts.get(tx.accountId)!;
    const dest = tx.destinationAccountId
      ? accounts.get(tx.destinationAccountId)
      : null;

    if (tx.type === 'EXPENSE')
      return acc instanceof CreditCard
        ? acc.payInvoice(tx.amount)
        : acc.credit(tx.amount);
    if (tx.type === 'INCOME')
      return acc instanceof CreditCard
        ? acc.registerCharge(tx.amount)
        : acc.debit(tx.amount);
    if (tx.type === 'TRANSFER' && dest) {
      const creditRes =
        acc instanceof CreditCard
          ? acc.payInvoice(tx.amount)
          : acc.credit(tx.amount);
      if (creditRes.isLeft()) return creditRes;
      return dest instanceof CreditCard
        ? dest.registerCharge(tx.amount)
        : dest.debit(tx.amount);
    }
    return right(undefined);
  }

  private applyMutations(
    tx: Transaction,
    accounts: Map<string, AnyAccount>,
  ): Either<Error, void> {
    if (tx.status !== TransactionStatus.COMPLETED) return right(undefined);

    const acc = accounts.get(tx.accountId)!;
    const dest = tx.destinationAccountId
      ? accounts.get(tx.destinationAccountId)
      : null;

    if (tx.type === 'EXPENSE')
      return acc instanceof CreditCard
        ? acc.registerCharge(tx.amount)
        : acc.debit(tx.amount);
    if (tx.type === 'INCOME')
      return acc instanceof CreditCard
        ? acc.payInvoice(tx.amount)
        : acc.credit(tx.amount);
    if (tx.type === 'TRANSFER' && dest) {
      const debitRes =
        acc instanceof CreditCard
          ? acc.registerCharge(tx.amount)
          : acc.debit(tx.amount);
      if (debitRes.isLeft()) return debitRes;
      return dest instanceof CreditCard
        ? dest.payInvoice(tx.amount)
        : dest.credit(tx.amount);
    }
    return right(undefined);
  }

  private async persistChanges(
    oldTx: Transaction,
    newTx: Transaction,
    accounts: Map<string, AnyAccount>,
  ): Promise<void> {
    const sourceNewBalance = Number(accounts.get(newTx.accountId)!.balance);
    const destNewBalance = newTx.destinationAccountId
      ? Number(accounts.get(newTx.destinationAccountId)!.balance)
      : undefined;

    const oldSourceId =
      oldTx.accountId === newTx.accountId ? undefined : oldTx.accountId;
    const oldSourceNewBalance = oldSourceId
      ? Number(accounts.get(oldSourceId)!.balance)
      : undefined;

    const oldDestId =
      oldTx.destinationAccountId &&
      oldTx.destinationAccountId !== newTx.destinationAccountId
        ? oldTx.destinationAccountId
        : null;
    const oldDestNewBalance = oldDestId
      ? Number(accounts.get(oldDestId)!.balance)
      : undefined;

    await this.transactionRepository.updateWithBalanceUpdate(
      newTx,
      sourceNewBalance,
      destNewBalance,
      oldDestId,
      oldDestNewBalance,
      oldSourceId,
      oldSourceNewBalance,
    );
  }
}
