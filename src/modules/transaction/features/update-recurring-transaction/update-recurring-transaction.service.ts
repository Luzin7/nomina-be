import { AccountType } from '@constants/enums';
import { AnyAccount } from '@modules/account/entities/types';
import { AccountNotFoundError } from '@modules/account/errors';
import { AccountRepository } from '@modules/account/repositories/contracts/AccountRepository';
import { CategoryNotFoundError } from '@modules/category/errors';
import { CategoryRepository } from '@modules/category/repositories/contracts/CategoryRepository';
import { RecurringTransaction } from '@modules/transaction/entities/RecurringTransaction';
import {
  CannotRemoveDestinationAccountError,
  CreditCardTransferNotAllowedError,
  RecurringTransactionNotFoundError,
  SourceAndDestinationAccountMustBeDifferentError,
  StartDateCannotBeTodayOrPastError,
} from '@modules/transaction/errors';
import { RecurringTransactionRepository } from '@modules/transaction/repositories/contracts/RecurringTransactionRepository';
import { Injectable } from '@nestjs/common';
import { TokenPayloadBase } from '@providers/auth/strategys/jwtStrategy';
import { DateProvider } from '@providers/date/contracts/DateProvider';
import { Service } from '@shared/core/contracts/Service';
import { Either, left, right } from '@shared/core/errors/Either';
import { UnauthorizedError } from '@shared/errors/UnauthorizedError';
import { UpdateRecurringTransactionRequest } from './update-recurring-transaction.dto';

type Request = UpdateRecurringTransactionRequest & {
  recurringTransactionId: string;
} & Pick<TokenPayloadBase, 'workspaceId'>;
type Response = RecurringTransaction;

@Injectable()
export class UpdateRecurringTransactionService implements Service<
  Request,
  Error,
  Response
> {
  constructor(
    private readonly recurringRepository: RecurringTransactionRepository,
    private readonly categoryRepository: CategoryRepository,
    private readonly accountRepository: AccountRepository,
    private readonly dateProvider: DateProvider,
  ) {}

  async execute(request: Request): Promise<Either<Error, Response>> {
    const baseValidation = await this.validateAndFetchBaseEntities(request);
    if (baseValidation.isLeft()) return left(baseValidation.value);
    const { recurring, account } = baseValidation.value;

    const depsValidation = await this.validateDependencies(
      request,
      recurring,
      account.id,
    );
    if (depsValidation.isLeft()) return left(depsValidation.value);

    const mutationResult = this.applyMutations(
      recurring,
      account.timezone,
      request,
    );
    if (mutationResult.isLeft()) return left(mutationResult.value);

    const updated = await this.recurringRepository.update(recurring);
    return right(updated);
  }

  private async validateAndFetchBaseEntities(
    request: Request,
  ): Promise<
    Either<Error, { recurring: RecurringTransaction; account: AnyAccount }>
  > {
    const recurring = await this.recurringRepository.findById(
      request.recurringTransactionId,
    );
    if (!recurring) return left(new RecurringTransactionNotFoundError());
    if (recurring.workspaceId !== request.workspaceId)
      return left(
        new UnauthorizedError('Transação não pertence ao workspace.'),
      );

    const account = await this.accountRepository.findById(
      request.accountId ?? recurring.accountId,
    );
    if (!account) return left(new AccountNotFoundError());
    if (account.workspaceId !== request.workspaceId) {
      return left(
        new UnauthorizedError('Conta inválida ou não pertence ao workspace.'),
      );
    }

    return right({ recurring, account });
  }

  private async validateDependencies(
    request: Request,
    recurring: RecurringTransaction,
    sourceAccountId: string,
  ): Promise<Either<Error, void>> {
    if (request.categoryId) {
      const categoryError = await this.validateCategory(
        request.categoryId,
        request.workspaceId,
      );
      if (categoryError) return left(categoryError);
    }

    if (request.destinationAccountId) {
      const destAccount = await this.accountRepository.findById(
        request.destinationAccountId,
      );
      if (destAccount?.workspaceId !== request.workspaceId) {
        return left(
          new UnauthorizedError(
            'Conta destino inválida ou não pertence ao workspace.',
          ),
        );
      }
      if (destAccount.type === AccountType.CREDIT_CARD) {
        return left(new CreditCardTransferNotAllowedError());
      }
    }

    const isTransfer =
      recurring.type === 'TRANSFER' || Boolean(request.destinationAccountId);
    const destinationAccountId =
      request.destinationAccountId !== undefined
        ? request.destinationAccountId
        : recurring.destinationAccountId;

    if (isTransfer && destinationAccountId === sourceAccountId) {
      return left(new SourceAndDestinationAccountMustBeDifferentError());
    }

    return right(undefined);
  }

  private async validateCategory(
    categoryId: string,
    workspaceId: string,
  ): Promise<Error | null> {
    const category = await this.categoryRepository.findById(categoryId);
    if (!category) return new CategoryNotFoundError();

    const isGlobalCategory = !category.workspaceId;
    const belongsToWorkspace = category.workspaceId === workspaceId;

    if (!isGlobalCategory && !belongsToWorkspace) {
      return new UnauthorizedError('Você não tem acesso a esta categoria.');
    }
    return null;
  }

  private applyMutations(
    recurring: RecurringTransaction,
    timezone: string,
    request: Request,
  ): Either<Error, void> {
    this.updateDetails(recurring, request);

    const accountResult = this.updateAccount(recurring, request.accountId);
    if (accountResult.isLeft()) return accountResult;

    if (request.amount !== undefined) {
      const amountResult = recurring.updateAmount(request.amount);
      if (amountResult.isLeft()) return amountResult;
    }

    const scheduleResult = this.updateSchedule(recurring, timezone, request);
    if (scheduleResult.isLeft()) return scheduleResult;

    const transferResult = this.updateDestination(
      recurring,
      request.destinationAccountId,
    );
    if (transferResult.isLeft()) return transferResult;

    return right(undefined);
  }

  private updateAccount(
    recurring: RecurringTransaction,
    accountId?: string,
  ): Either<Error, void> {
    if (accountId === undefined || accountId === recurring.accountId) {
      return right(undefined);
    }

    return recurring.changeAccount(accountId);
  }

  private updateDetails(
    recurring: RecurringTransaction,
    request: Request,
  ): void {
    const hasDetailsUpdate =
      request.title !== undefined ||
      request.description !== undefined ||
      request.categoryId !== undefined;
    if (!hasDetailsUpdate) return;

    recurring.updateDetails(
      request.title ?? recurring.title,
      request.description === undefined
        ? recurring.description
        : request.description,
      request.categoryId ?? recurring.categoryId,
    );
  }

  private updateSchedule(
    recurring: RecurringTransaction,
    tz: string,
    request: Request,
  ): Either<Error, void> {
    const hasScheduleUpdate =
      request.startDate !== undefined ||
      request.endDate !== undefined ||
      request.frequency !== undefined ||
      request.interval !== undefined;
    if (!hasScheduleUpdate) return right(undefined);

    const newStartDate = request.startDate
      ? this.dateProvider.startOfDay(request.startDate, tz)
      : recurring.startDate;

    let newEndDate = recurring.endDate;
    if (request.endDate !== undefined) {
      newEndDate = request.endDate
        ? this.dateProvider.startOfDay(request.endDate, tz)
        : null;
    }

    const startDateChanged =
      request.startDate !== undefined &&
      newStartDate.getTime() !==
        this.dateProvider.startOfDay(recurring.startDate, tz).getTime();

    if (startDateChanged) {
      const today = this.dateProvider.startOfDay(this.dateProvider.now(), tz);
      if (newStartDate <= today) {
        return left(new StartDateCannotBeTodayOrPastError());
      }
    }

    const scheduleResult = recurring.updateSchedule(
      newStartDate,
      newEndDate,
      request.frequency ?? recurring.frequency,
      request.interval ?? recurring.interval,
    );
    if (scheduleResult.isLeft()) return scheduleResult;

    if (startDateChanged) recurring.clearLastGenerated();

    return right(undefined);
  }

  private updateDestination(
    recurring: RecurringTransaction,
    destinationAccountId?: string | null,
  ): Either<Error, void> {
    if (destinationAccountId === undefined) return right(undefined);

    if (destinationAccountId === null) {
      if (recurring.type === 'TRANSFER') {
        return left(new CannotRemoveDestinationAccountError());
      }
      return right(undefined);
    }

    recurring.convertToTransfer(destinationAccountId);

    return right(undefined);
  }
}
