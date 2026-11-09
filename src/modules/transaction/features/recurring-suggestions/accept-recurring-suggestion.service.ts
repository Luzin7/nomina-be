import {
  RecurrenceFrequency,
  RecurringSuggestionStatus,
} from '@constants/enums';
import { CacheProvider } from '@infra/cache/contracts/CacheProvider';
import { GetWorkspaceTimezoneService } from '@modules/workspace/services/get-workspace-timezone.service';
import { RecurringTransaction } from '@modules/transaction/entities/RecurringTransaction';
import {
  RecurringRuleMissingError,
  RecurringSuggestionDismissedError,
  RecurringSuggestionNotFoundError,
} from '@modules/transaction/errors';
import { RecurringSuggestionRepository } from '@modules/transaction/repositories/contracts/RecurringSuggestionRepository';
import {
  CalendarDate,
  nextStrictlyFutureOccurrence,
} from '@modules/transaction/valueObjects/MonthlyOccurrence';
import { Injectable } from '@nestjs/common';
import { TokenPayloadBase } from '@providers/auth/strategys/jwtStrategy';
import { DateProvider } from '@providers/date/contracts/DateProvider';
import { bumpReportGeneration } from '@shared/cache/report-cache';
import { Service } from '@shared/core/contracts/Service';
import { Either, left, right } from '@shared/core/errors/Either';

type Request = Pick<TokenPayloadBase, 'workspaceId'> & {
  suggestionId: string;
  title?: string;
};

type Response = { recurringId: string };

const pad = (value: number): string => String(value).padStart(2, '0');

const toDateKey = ({ year, month, day }: CalendarDate): string =>
  `${year}-${pad(month)}-${pad(day)}`;

const parseDateKey = (value: string): CalendarDate => {
  const [year, month, day] = value.split('-').map(Number);

  return { year, month, day };
};

@Injectable()
export class AcceptRecurringSuggestionService implements Service<
  Request,
  Error,
  Response
> {
  constructor(
    private readonly suggestionRepository: RecurringSuggestionRepository,
    private readonly timezoneService: GetWorkspaceTimezoneService,
    private readonly dateProvider: DateProvider,
    private readonly cacheProvider: CacheProvider,
  ) {}

  async execute({
    workspaceId,
    suggestionId,
    title,
  }: Request): Promise<Either<Error, Response>> {
    const suggestion = await this.suggestionRepository.findByIdForWorkspace({
      suggestionId,
      workspaceId,
    });

    if (!suggestion) return left(new RecurringSuggestionNotFoundError());
    if (suggestion.status === RecurringSuggestionStatus.DISMISSED) {
      return left(new RecurringSuggestionDismissedError());
    }

    const timezone = await this.timezoneService.execute(workspaceId);
    const startDate = this.nextOccurrenceStart(suggestion.dayOfMonth, timezone);

    const ruleOrError = RecurringTransaction.create({
      workspaceId,
      accountId: suggestion.accountId,
      categoryId: suggestion.categoryId,
      title: title ?? suggestion.suggestedTitle,
      description: null,
      amount: suggestion.amount,
      frequency: RecurrenceFrequency.MONTHLY,
      interval: 1,
      type: 'EXPENSE',
      startDate,
      active: true,
    });

    if (ruleOrError.isLeft()) return left(ruleOrError.value);

    const outcome = await this.suggestionRepository.accept({
      suggestionId,
      workspaceId,
      rule: ruleOrError.value,
    });

    if (outcome.kind === 'not-found') {
      return left(new RecurringSuggestionNotFoundError());
    }
    if (outcome.kind === 'dismissed') {
      return left(new RecurringSuggestionDismissedError());
    }

    if (outcome.kind === 'accepted') {
      await bumpReportGeneration(this.cacheProvider, workspaceId);

      return right({ recurringId: outcome.recurringId });
    }

    if (!outcome.recurringId) {
      return left(new RecurringRuleMissingError());
    }

    return right({ recurringId: outcome.recurringId });
  }

  private nextOccurrenceStart(dayOfMonth: number, timezone: string): Date {
    const today = parseDateKey(
      this.dateProvider.format(this.dateProvider.now(), 'YYYY-MM-DD', timezone),
    );
    const occurrence = nextStrictlyFutureOccurrence(today, dayOfMonth);

    return this.dateProvider.startOfDay(toDateKey(occurrence), timezone);
  }
}
