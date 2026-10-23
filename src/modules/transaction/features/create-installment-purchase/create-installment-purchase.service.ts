import {
  AccountType,
  RecurrenceFrequency,
  TransactionStatus,
} from '@constants/enums';
import { CacheProvider } from '@infra/cache/contracts/CacheProvider';
import { AccountRepository } from '@modules/account/repositories/contracts/AccountRepository';
import { CategoryNotFoundError } from '@modules/category/errors';
import { CategoryRepository } from '@modules/category/repositories/contracts/CategoryRepository';
import { RecurringTransaction } from '@modules/transaction/entities/RecurringTransaction';
import { Transaction } from '@modules/transaction/entities/Transaction';
import {
  InstallmentCountOutOfRangeError,
  InvestmentAccountNotAllowedError,
} from '@modules/transaction/errors';
import { TransactionRepository } from '@modules/transaction/repositories/contracts/TransactionRepository';
import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { TokenPayloadBase } from '@providers/auth/strategys/jwtStrategy';
import { DateProvider } from '@providers/date/contracts/DateProvider';
import { Service } from '@shared/core/contracts/Service';
import { Either, left, right } from '@shared/core/errors/Either';
import { UnauthorizedError } from '@shared/errors/UnauthorizedError';
import {
  calculateInstallmentEndDate,
  MAX_INSTALLMENTS,
} from '@utils/installmentSchedule';
import {
  CreateInstallmentPurchaseRequest,
  MIN_PURCHASE_INSTALLMENTS,
} from './create-installment-purchase.dto';

type Request = CreateInstallmentPurchaseRequest & TokenPayloadBase;

export type InstallmentPurchase = {
  recurring: RecurringTransaction;
  firstInstallment: Transaction;
};

@Injectable()
export class CreateInstallmentPurchaseService implements Service<
  Request,
  Error,
  InstallmentPurchase
> {
  constructor(
    private readonly accountRepository: AccountRepository,
    private readonly categoryRepository: CategoryRepository,
    private readonly transactionRepository: TransactionRepository,
    private readonly dateProvider: DateProvider,
    private readonly cache: CacheProvider,
  ) {}

  async execute(request: Request): Promise<Either<Error, InstallmentPurchase>> {
    const { workspaceId, installments } = request;

    if (
      installments < MIN_PURCHASE_INSTALLMENTS ||
      installments > MAX_INSTALLMENTS
    ) {
      return left(
        new InstallmentCountOutOfRangeError(
          MIN_PURCHASE_INSTALLMENTS,
          MAX_INSTALLMENTS,
        ),
      );
    }

    const account = await this.accountRepository.findById(request.accountId);
    if (account?.workspaceId !== workspaceId) {
      return left(new UnauthorizedError());
    }
    if (account.type === AccountType.INVESTMENT) {
      return left(new InvestmentAccountNotAllowedError());
    }

    const categoryError = await this.validateCategory(
      request.categoryId,
      workspaceId,
    );
    if (categoryError) return left(categoryError);

    const timezone = account.timezone;
    const firstDate = this.dateProvider.startOfDay(
      request.purchaseDate,
      timezone,
    );
    const baseAmount = request.totalAmount / BigInt(installments);
    const remainder = request.totalAmount - baseAmount * BigInt(installments);

    const recurringOrError = RecurringTransaction.create(
      {
        workspaceId,
        accountId: request.accountId,
        title: request.title,
        description: request.description ?? null,
        categoryId: request.categoryId,
        amount: baseAmount,
        frequency: RecurrenceFrequency.MONTHLY,
        interval: 1,
        installmentCount: installments,
        type: request.type,
        startDate: firstDate,
        endDate: calculateInstallmentEndDate(
          {
            startDate: firstDate,
            frequency: RecurrenceFrequency.MONTHLY,
            interval: 1,
            installments,
            timezone,
          },
          this.dateProvider,
        ),
        lastGenerated: firstDate,
      },
      randomUUID(),
    );
    if (recurringOrError.isLeft()) return left(recurringOrError.value);
    const recurring = recurringOrError.value;

    const firstOrError = Transaction.create(
      {
        workspaceId,
        accountId: request.accountId,
        categoryId: request.categoryId,
        title: request.title,
        description: request.description ?? null,
        amount: baseAmount + remainder,
        date: firstDate,
        type: request.type,
        status: this.resolveStatus(firstDate, timezone),
        recurringId: recurring.id,
      },
      randomUUID(),
    );
    if (firstOrError.isLeft()) return left(firstOrError.value);
    const firstInstallment = firstOrError.value;

    const persisted = await this.transactionRepository.createInstallmentPlan(
      { recurring, firstInstallment },
      { actorId: request.sub },
    );
    if (persisted.isLeft()) return left(persisted.value);

    await this.cache.delByPattern(`report:*:${workspaceId}:*`);

    return right({ recurring, firstInstallment });
  }

  private async validateCategory(
    categoryId: string,
    workspaceId: string,
  ): Promise<Error | null> {
    const category = await this.categoryRepository.findById(categoryId);
    if (!category) return new CategoryNotFoundError();

    if (category.workspaceId && category.workspaceId !== workspaceId) {
      return new UnauthorizedError('Categoria não pertence ao workspace.');
    }

    return null;
  }

  private resolveStatus(firstDate: Date, timezone: string): TransactionStatus {
    const today = this.dateProvider.startOfDay(
      this.dateProvider.now(),
      timezone,
    );

    return firstDate > today
      ? TransactionStatus.PENDING
      : TransactionStatus.COMPLETED;
  }
}
