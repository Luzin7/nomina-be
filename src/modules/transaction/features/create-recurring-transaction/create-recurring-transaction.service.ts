import { RecurrenceFrequency } from '@constants/enums';
import { AccountRepository } from '@modules/account/repositories/contracts/AccountRepository';
import { SYSTEM_CATEGORY } from '@modules/category/constants/system-categories';
import { CategoryNotFoundError } from '@modules/category/errors';
import { CategoryRepository } from '@modules/category/repositories/contracts/CategoryRepository';
import { resolveSystemCategoryId } from '@modules/category/services/resolve-system-category';
import { RecurringTransaction } from '@modules/transaction/entities/RecurringTransaction';
import { StartDateCannotBeTodayOrPastError } from '@modules/transaction/errors';
import { RecurringTransactionRepository } from '@modules/transaction/repositories/contracts/RecurringTransactionRepository';
import { Injectable } from '@nestjs/common';
import { TokenPayloadBase } from '@providers/auth/strategys/jwtStrategy';
import { DateProvider } from '@providers/date/contracts/DateProvider';
import { Service } from '@shared/core/contracts/Service';
import { Either, left, right } from '@shared/core/errors/Either';
import { UnauthorizedError } from '@shared/errors/UnauthorizedError';
import { MoneyUtils } from '@utils/MoneyUtils';
import { CreateRecurringTransactionRequest } from './create-recurring-transaction.dto';

type Request = CreateRecurringTransactionRequest & TokenPayloadBase;

@Injectable()
export class CreateRecurringTransactionService implements Service<
  Request,
  Error,
  RecurringTransaction
> {
  constructor(
    private readonly recurringRepository: RecurringTransactionRepository,
    private readonly accountRepository: AccountRepository,
    private readonly categoryRepository: CategoryRepository,
    private readonly dateProvider: DateProvider,
  ) {}

  async execute(
    request: Request,
  ): Promise<Either<Error, RecurringTransaction>> {
    const {
      workspaceId,
      accountId,
      categoryId,
      destinationAccountId,
      startDate,
      endDate,
    } = request;

    const account = await this.accountRepository.findById(accountId);
    if (account?.workspaceId !== workspaceId) {
      return left(new UnauthorizedError());
    }

    const destinationError = await this.validateDestinationAccount(
      destinationAccountId,
      workspaceId,
    );
    if (destinationError) return left(destinationError);

    const categoryResult = await this.resolveCategoryId(
      categoryId,
      workspaceId,
    );
    if (categoryResult.isLeft()) return left(categoryResult.value);
    const resolvedCategoryId = categoryResult.value;

    const accountTz = account.timezone;
    const start = this.dateProvider.startOfDay(startDate, accountTz);
    const today = this.dateProvider.startOfDay(
      this.dateProvider.now(),
      accountTz,
    );

    if (start <= today) {
      return left(new StartDateCannotBeTodayOrPastError());
    }

    const { amount, end } = this.resolveAmountAndEndDate(
      request,
      start,
      endDate,
      accountTz,
    );

    const recurringOrError = RecurringTransaction.create({
      workspaceId,
      accountId,
      destinationAccountId: destinationAccountId ?? null,
      title: request.title,
      description: request.description ?? null,
      categoryId: resolvedCategoryId,
      amount,
      frequency: request.frequency as RecurrenceFrequency,
      interval: request.interval,
      type: request.type,
      startDate: start,
      endDate: end,
      active: request.active,
    });

    if (recurringOrError.isLeft()) {
      return left(recurringOrError.value);
    }

    const created = await this.recurringRepository.create(
      recurringOrError.value,
    );
    return right(created);
  }

  private async validateDestinationAccount(
    destinationAccountId: string | null | undefined,
    workspaceId: string,
  ): Promise<Error | null> {
    if (!destinationAccountId) return null;

    const destAccount =
      await this.accountRepository.findById(destinationAccountId);
    if (destAccount?.workspaceId !== workspaceId) {
      return new UnauthorizedError();
    }

    return null;
  }

  /**
   * Sem `categoryId` a recorrência é uma transferência: o backend atribui a
   * categoria de sistema. Ver create-transaction.service.ts.
   */
  private async resolveCategoryId(
    categoryId: string | null | undefined,
    workspaceId: string,
  ): Promise<Either<Error, string>> {
    if (!categoryId) {
      return resolveSystemCategoryId(
        this.categoryRepository,
        SYSTEM_CATEGORY.TRANSFER,
      );
    }

    const category = await this.categoryRepository.findById(categoryId);
    if (!category) return left(new CategoryNotFoundError());

    const isGlobalCategory = !category.workspaceId;
    const belongsToWorkspace = category.workspaceId === workspaceId;

    if (!isGlobalCategory && !belongsToWorkspace) {
      return left(
        new UnauthorizedError('Você não tem acesso a esta categoria.'),
      );
    }

    return right(category.id);
  }

  private resolveAmountAndEndDate(
    request: Request,
    start: Date,
    endDate: string | null | undefined,
    timezone: string,
  ): { amount: bigint; end: Date | null } {
    const isTotalAmountMode = request.amount === undefined;

    if (isTotalAmountMode) {
      const amount = MoneyUtils.splitIntoInstallments(
        request.totalAmount!,
        request.installments!,
      );
      const end = this.calculateInstallmentEndDate(
        start,
        request.frequency as RecurrenceFrequency,
        request.interval,
        request.installments!,
        timezone,
      );
      return { amount, end };
    }

    return {
      amount: request.amount!,
      end: this.resolveManualEndDate(endDate, timezone),
    };
  }

  private resolveManualEndDate(
    endDate: string | null | undefined,
    timezone: string,
  ): Date | null {
    if (!endDate) return null;
    return this.dateProvider.startOfDay(endDate, timezone);
  }

  private calculateInstallmentEndDate(
    start: Date,
    frequency: RecurrenceFrequency,
    interval: number,
    installments: number,
    timezone: string,
  ): Date {
    const remainingOccurrences = installments - 1;

    switch (frequency) {
      case RecurrenceFrequency.WEEKLY:
        return this.dateProvider.add(
          start,
          interval * 7 * remainingOccurrences,
          'day',
          timezone,
        );
      case RecurrenceFrequency.MONTHLY:
        return this.dateProvider.add(
          start,
          interval * remainingOccurrences,
          'month',
          timezone,
        );
      case RecurrenceFrequency.YEARLY:
        return this.dateProvider.add(
          start,
          interval * remainingOccurrences,
          'year',
          timezone,
        );
      default:
        throw new Error(`Unknown frequency: ${frequency}`);
    }
  }
}
