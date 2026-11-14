import { CacheProvider } from '@infra/cache/contracts/CacheProvider';
import { CreditCard } from '@modules/account/entities/CreditCardAccount';
import {
  AccountNotFoundError,
  AccountTypeError,
} from '@modules/account/errors';
import { AccountRepository } from '@modules/account/repositories/contracts/AccountRepository';
import { InvoiceCalendar } from '@modules/account/valueObjects/InvoiceCalendar';
import {
  CardCycleBudgetExistsError,
  CardCycleNotConfiguredError,
  HistoricalCardCycleBudgetError,
  InvalidCardCycleLimitError,
} from '@modules/card-cycle/errors';
import { CardCycleRepository } from '@modules/card-cycle/repositories/contracts/CardCycleRepository';
import { Injectable } from '@nestjs/common';
import { TokenPayloadSchema } from '@providers/auth/strategys/jwtStrategy';
import { DateProvider } from '@providers/date/contracts/DateProvider';
import { invalidateLedgerReads } from '@shared/cache/report-cache';
import { Service } from '@shared/core/contracts/Service';
import { Either, left, right } from '@shared/core/errors/Either';
import { UnauthorizedError } from '@shared/errors/UnauthorizedError';
import { SaveCardCycleBudgetRequest } from './save-card-cycle-budget.dto';

type Request = SaveCardCycleBudgetRequest &
  Pick<TokenPayloadSchema, 'workspaceId'> & { accountId: string };

export type SaveCardCycleBudgetResponse = {
  accountId: string;
  effectiveFrom: string;
  limitCents: number;
};

@Injectable()
export class SaveCardCycleBudgetService implements Service<
  Request,
  Error,
  SaveCardCycleBudgetResponse
> {
  constructor(
    private readonly accountRepository: AccountRepository,
    private readonly cardCycleRepository: CardCycleRepository,
    private readonly dateProvider: DateProvider,
    private readonly cache: CacheProvider,
  ) {}

  async execute(
    request: Request,
  ): Promise<Either<Error, SaveCardCycleBudgetResponse>> {
    if (!isValidCardCycleLimit(request.limitCents))
      return left(new InvalidCardCycleLimitError());

    const account = await this.accountRepository.findById(request.accountId);

    if (!account) return left(new AccountNotFoundError());

    if (account.workspaceId !== request.workspaceId)
      return left(new UnauthorizedError());

    if (!(account instanceof CreditCard)) return left(new AccountTypeError());

    const dueDay: number | null = account.dueDay;
    if (dueDay === null) return left(new CardCycleNotConfiguredError());

    const currentDueDate = this.currentDueDateOf(account, dueDay);
    if (request.effectiveFrom < currentDueDate)
      return left(new HistoricalCardCycleBudgetError());

    try {
      const saved = await this.cardCycleRepository.saveBudget({
        workspaceId: request.workspaceId,
        accountId: account.id,
        effectiveFrom: request.effectiveFrom,
        limitCents: request.limitCents,
      });

      await invalidateLedgerReads(
        this.cache,
        request.workspaceId,
        'save-card-cycle-budget',
      );

      return right({
        accountId: account.id,
        effectiveFrom: saved.effectiveFrom,
        limitCents: saved.limitCents,
      });
    } catch (error) {
      if (error instanceof CardCycleBudgetExistsError) return left(error);

      throw error;
    }
  }

  private currentDueDateOf(account: CreditCard, dueDay: number): string {
    const calendar = new InvoiceCalendar({
      dueDay,
      closingDaysBeforeDue: account.closingDaysBeforeDue,
    });
    const today = this.dateProvider.format(
      this.dateProvider.now(),
      'YYYY-MM-DD',
      account.timezone,
    );

    return calendar.bounds(calendar.invoiceKeyFor(today)).dueDate;
  }
}

function isValidCardCycleLimit(limitCents: number): boolean {
  return Number.isInteger(limitCents) && limitCents >= 0;
}
