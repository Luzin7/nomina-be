import { TransactionStatus } from '@constants/enums';
import { CacheProvider } from '@infra/cache/contracts/CacheProvider';
import { CreditCard } from '@modules/account/entities/CreditCardAccount';
import { AnyAccount } from '@modules/account/entities/types';
import { AccountRepository } from '@modules/account/repositories/contracts/AccountRepository';
import { SYSTEM_CATEGORY } from '@modules/category/constants/system-categories';
import { CategoryRepository } from '@modules/category/repositories/contracts/CategoryRepository';
import { Transaction } from '@modules/transaction/entities/Transaction';
import {
  CreditCardTransferNotAllowedError,
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

interface ResolvedEdit {
  categoryId: string;
  date: Date;
  status: TransactionStatus;
}

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
    private readonly redisService: CacheProvider,
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

    const categoryId = await this.resolveCategoryId(request);
    if (categoryId.isLeft()) return left(categoryId.value);

    const resolvedEdit = this.resolveEdit(
      request,
      categoryId.value,
      accountsResult.value.get(request.accountId)!,
    );

    const updateResult =
      await this.transactionRepository.updateWithBalanceEffect(
        request.transactionId,
        (current) =>
          this.buildUpdatedTransaction(current, request, resolvedEdit),
      );
    if (updateResult.isLeft()) return left(updateResult.value);

    await this.redisService.delByPattern(`report:*:${request.workspaceId}:*`);

    return right(updateResult.value);
  }

  /**
   * Transferência: o backend atribui a categoria de sistema, o usuário não
   * escolhe. Ver create-transaction.service.ts.
   */
  private async resolveCategoryId(
    request: Request,
  ): Promise<Either<Error, string>> {
    if (!request.categoryId) return right(SYSTEM_CATEGORY.TRANSFER.id);

    const categoryError = await this.validateCategory(
      request.categoryId,
      request.workspaceId,
    );
    if (categoryError) return left(categoryError);

    return right(request.categoryId);
  }

  private resolveEdit(
    request: Request,
    categoryId: string,
    sourceAccount: AnyAccount,
  ): ResolvedEdit {
    const date = this.dateProvider.startOfDay(
      request.date,
      sourceAccount.timezone,
    );
    const today = this.dateProvider.startOfDay(
      this.dateProvider.now(),
      sourceAccount.timezone,
    );

    return {
      categoryId,
      date,
      status: date > today ? TransactionStatus.PENDING : request.status,
    };
  }

  private buildUpdatedTransaction(
    current: Transaction,
    request: Request,
    edit: ResolvedEdit,
  ): Either<Error, Transaction> {
    return Transaction.create(
      {
        ...request,
        workspaceId: request.workspaceId,
        date: edit.date,
        status: edit.status,
        destinationAccountId: request.destinationAccountId ?? null,
        categoryId: edit.categoryId,
        description: request.description ?? null,
        recurringId: current.recurringId,
        createdAt: current.createdAt,
        updatedAt: new Date(),
      },
      current.id,
    );
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

    const destination = request.destinationAccountId
      ? accountsMap.get(request.destinationAccountId)
      : null;
    if (request.type === 'TRANSFER' && destination instanceof CreditCard) {
      return left(new CreditCardTransferNotAllowedError());
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
}
