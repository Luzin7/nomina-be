import { RecurrenceFrequency } from '@constants/enums';
import { RECURRING_GENERATION_TIMEZONE } from '@constants/timezone';
import { MonthProjectionRepository } from '@modules/report/repositories/contracts/MonthProjectionRepository';
import { projectMonth } from '@modules/report/valueObjects/ProjectionHorizon';
import { LOOKBACK_MONTHS } from '@modules/report/valueObjects/ProjectionRules';
import {
  RecurringSummaryRule,
  RecurringTransactionRepository,
} from '@modules/transaction/repositories/contracts/RecurringTransactionRepository';
import { GetWorkspaceTimezoneService } from '@modules/workspace/services/get-workspace-timezone.service';
import { Injectable } from '@nestjs/common';
import { TokenPayloadBase } from '@providers/auth/strategys/jwtStrategy';
import { DateProvider } from '@providers/date/contracts/DateProvider';
import { Service } from '@shared/core/contracts/Service';
import { Either, right } from '@shared/core/errors/Either';
import { nextOccurrence } from '@utils/installmentSchedule';

const NEXT_DAYS_WINDOW = 30;
const MAX_OCCURRENCE_STEPS = 1000;

const FREQUENCY_ORDER: Record<RecurrenceFrequency, number> = {
  [RecurrenceFrequency.WEEKLY]: 0,
  [RecurrenceFrequency.MONTHLY]: 1,
  [RecurrenceFrequency.YEARLY]: 2,
};

type Request = Pick<TokenPayloadBase, 'workspaceId'>;

export type RecurringSummaryFrequency = {
  frequency: RecurrenceFrequency;
  interval: number;
  count: number;
  monthlyEquivalentCents: number;
};

export type RecurringSummaryEntry = {
  date: string;
  name: string;
  amountCents: number;
  type: 'INCOME' | 'EXPENSE';
};

export type RecurringSummary = {
  monthlyEquivalentCents: number;
  activeCount: number;
  pausedCount: number;
  exhaustedCount: number;
  materializedThisMonthCents: number;
  stillToComeThisMonthCents: number;
  next30Days: RecurringSummaryEntry[];
  byFrequency: RecurringSummaryFrequency[];
};

const safeInterval = (interval: number): number =>
  interval > 0 ? interval : 1;

export const monthlyEquivalentCents = (
  rule: Pick<RecurringSummaryRule, 'amount' | 'frequency' | 'interval'>,
): number => {
  const interval = safeInterval(rule.interval);

  switch (rule.frequency) {
    case RecurrenceFrequency.WEEKLY:
      return Math.ceil((rule.amount * 52) / (12 * interval));
    case RecurrenceFrequency.MONTHLY:
      return Math.ceil(rule.amount / interval);
    case RecurrenceFrequency.YEARLY:
      return Math.ceil(rule.amount / (12 * interval));
  }
};

const isContributing = (rule: RecurringSummaryRule): boolean =>
  rule.active && !rule.exhausted;

const countRules = (
  rules: RecurringSummaryRule[],
): Pick<RecurringSummary, 'activeCount' | 'pausedCount' | 'exhaustedCount'> => {
  const counts = { activeCount: 0, pausedCount: 0, exhaustedCount: 0 };

  for (const rule of rules) {
    if (rule.exhausted) {
      counts.exhaustedCount += 1;
      continue;
    }
    if (!rule.active) {
      counts.pausedCount += 1;
      continue;
    }
    counts.activeCount += 1;
  }

  return counts;
};

type OccurrenceWindow = {
  rule: RecurringSummaryRule;
  start: Date;
  end: Date;
  dateProvider: DateProvider;
};

const occurrencesInWindow = ({
  rule,
  start,
  end,
  dateProvider,
}: OccurrenceWindow): Date[] => {
  const occurrences: Date[] = [];
  let cursor = rule.startDate;

  for (let step = 0; step < MAX_OCCURRENCE_STEPS; step++) {
    if (cursor.getTime() > end.getTime()) break;
    if (rule.endDate !== null && cursor.getTime() > rule.endDate.getTime()) {
      break;
    }
    if (cursor.getTime() >= start.getTime()) occurrences.push(cursor);
    cursor = nextOccurrence(
      {
        startDate: cursor,
        frequency: rule.frequency,
        interval: rule.interval,
        timezone: RECURRING_GENERATION_TIMEZONE,
      },
      dateProvider,
    );
  }

  return occurrences;
};

type Next30DaysWindow = {
  rules: RecurringSummaryRule[];
  start: Date;
  end: Date;
  timezone: string;
  dateProvider: DateProvider;
};

const next30Days = ({
  rules,
  start,
  end,
  timezone,
  dateProvider,
}: Next30DaysWindow): RecurringSummaryEntry[] =>
  rules
    .filter(isContributing)
    .flatMap((rule) =>
      occurrencesInWindow({ rule, start, end, dateProvider }).map((date) => ({
        date: dateProvider.format(date, 'YYYY-MM-DD', timezone),
        name: rule.title,
        amountCents: rule.amount,
        type: rule.type,
      })),
    )
    .sort(
      (a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name),
    );

const byFrequency = (
  rules: RecurringSummaryRule[],
): RecurringSummaryFrequency[] => {
  const groups = new Map<string, RecurringSummaryFrequency>();

  for (const rule of rules.filter(isContributing)) {
    const key = `${rule.frequency}:${rule.interval}`;
    const group = groups.get(key) ?? {
      frequency: rule.frequency,
      interval: rule.interval,
      count: 0,
      monthlyEquivalentCents: 0,
    };
    group.count += 1;
    group.monthlyEquivalentCents += monthlyEquivalentCents(rule);
    groups.set(key, group);
  }

  return [...groups.values()].sort(
    (a, b) =>
      FREQUENCY_ORDER[a.frequency] - FREQUENCY_ORDER[b.frequency] ||
      a.interval - b.interval,
  );
};

@Injectable()
export class RecurringSummaryService implements Service<
  Request,
  Error,
  RecurringSummary
> {
  constructor(
    private readonly recurringRepository: RecurringTransactionRepository,
    private readonly monthProjectionRepository: MonthProjectionRepository,
    private readonly workspaceTimezone: GetWorkspaceTimezoneService,
    private readonly dateProvider: DateProvider,
  ) {}

  async execute({
    workspaceId,
  }: Request): Promise<Either<Error, RecurringSummary>> {
    const now = this.dateProvider.now();
    const timezone = await this.workspaceTimezone.execute(workspaceId);
    const currentMonthStart = this.dateProvider.startOfMonth(now, timezone);
    const currentMonthEnd = this.dateProvider.endOfMonth(now, timezone);
    const todayStart = this.dateProvider.startOfDay(now, timezone);
    const windowEnd = this.dateProvider.endOfDay(
      this.dateProvider.add(todayStart, NEXT_DAYS_WINDOW, 'day', timezone),
      timezone,
    );
    const lookbackStart = this.dateProvider.startOfMonth(
      this.dateProvider.add(
        currentMonthStart,
        -LOOKBACK_MONTHS,
        'month',
        timezone,
      ),
      timezone,
    );

    const [rules, ledger, recurringRules, materializedThisMonthCents] =
      await Promise.all([
        this.recurringRepository.findSummaryRules({
          workspaceId,
          todayStart,
          timezone,
        }),
        this.monthProjectionRepository.findMonthLedger({
          workspaceId,
          timezone,
          range: { start: lookbackStart, end: currentMonthEnd },
          currentMonthStart,
        }),
        this.monthProjectionRepository.findActiveRecurringRules(workspaceId, {
          start: currentMonthStart,
          end: currentMonthEnd,
        }),
        this.recurringRepository.findCompletedRecurringExpense(
          workspaceId,
          currentMonthStart,
          currentMonthEnd,
        ),
      ]);

    const monthKey = this.dateProvider.format(
      currentMonthStart,
      'YYYY-MM',
      timezone,
    );
    const currentLedger = ledger.find((month) => month.key === monthKey);
    const projection = projectMonth({
      month: {
        key: monthKey,
        start: currentMonthStart,
        end: currentMonthEnd,
        days: Number(this.dateProvider.format(currentMonthEnd, 'D', timezone)),
      },
      asOf: now,
      timezone,
      realized: {
        totalIncome: currentLedger?.totalIncome ?? 0,
        totalExpense: currentLedger?.totalExpense ?? 0,
      },
      ledger,
      recurringRules,
    });

    return right({
      monthlyEquivalentCents: rules
        .filter(isContributing)
        .reduce((total, rule) => total + monthlyEquivalentCents(rule), 0),
      ...countRules(rules),
      materializedThisMonthCents,
      stillToComeThisMonthCents:
        projection.recurringNotYetGenerated.totalExpense,
      next30Days: next30Days({
        rules,
        start: todayStart,
        end: windowEnd,
        timezone,
        dateProvider: this.dateProvider,
      }),
      byFrequency: byFrequency(rules),
    });
  }
}
