import {
  BudgetRepository,
  type BudgetSnapshot,
} from '@modules/budget/repositories/contracts/BudgetRepository';
import {
  ResolveBudgetSuggestionService,
  type BudgetSuggestion,
} from '@modules/budget/services/resolve-budget-suggestion.service';
import { MonthProjectionRepository } from '@modules/report/repositories/contracts/MonthProjectionRepository';
import { expenseOccurrencesByDay } from '@modules/report/valueObjects/MonthPace';
import {
  LedgerMonth,
  RecurringRuleSnapshot,
  sumNotYetGeneratedOccurrences,
} from '@modules/report/valueObjects/MonthProjection';
import { LOOKBACK_MONTHS } from '@modules/report/valueObjects/ProjectionRules';
import {
  buildProvisionalPlan,
  type PlainExpenseOn,
  type ProvisionalBasis,
} from '@modules/report/valueObjects/ProvisionalPlan';
import { GetWorkspaceTimezoneService } from '@modules/workspace/services/get-workspace-timezone.service';
import { Injectable, Logger } from '@nestjs/common';
import { captureException } from '@sentry/nestjs';
import { TokenPayloadSchema } from '@providers/auth/strategys/jwtStrategy';
import { DateProvider } from '@providers/date/contracts/DateProvider';
import { Service } from '@shared/core/contracts/Service';
import { Either, right } from '@shared/core/errors/Either';
import { daysInMonth } from '@utils/calendarMonth';
import { nextOccurrenceAfter } from '@utils/installmentSchedule';

type Request = Pick<TokenPayloadSchema, 'workspaceId'> & {
  month: number;
  year: number;
  today: string;
};

export type ResolvedMonthPlan =
  | { source: 'declared'; planTotalCents: number; snapshot: BudgetSnapshot }
  | {
      source: 'suggested';
      planTotalCents: number;
      spentCents: number;
      basisMonths: number;
    }
  | {
      source: 'provisional';
      planTotalCents: number;
      basis: ProvisionalBasis;
      spentCents: number;
      degraded?: true;
    }
  | {
      source: 'nothing-observed';
      recurringDueCents: number;
      spentCents: number;
      degraded?: true;
    }
  | { source: 'none' };

type MonthWindow = {
  key: string;
  start: Date;
  end: Date;
  days: number;
  today: string;
};

const sum = (values: number[]): number =>
  values.reduce((total, value) => total + value, 0);

type SuggestionOutcome = {
  suggestion: BudgetSuggestion | null;
  failed: boolean;
};

const describeError = (error: unknown): string =>
  error instanceof Error
    ? `${error.constructor.name}: ${error.message}`
    : typeof error;

const canSuggest = ({ planEligible, split }: BudgetSuggestion): boolean =>
  planEligible && split.status !== 'rejected';

const completedPlainExpensesOf = (ledger: LedgerMonth[]): PlainExpenseOn[] =>
  ledger.flatMap(({ key, plainExpenses }) =>
    plainExpenses
      .filter(({ pending }) => !pending)
      .map(({ day, amount }) => ({
        date: `${key}-${String(day).padStart(2, '0')}`,
        amount,
      })),
  );

@Injectable()
export class ResolveMonthPlanService implements Service<
  Request,
  Error,
  ResolvedMonthPlan
> {
  private readonly logger = new Logger(ResolveMonthPlanService.name);

  constructor(
    private readonly budgetRepository: BudgetRepository,
    private readonly monthProjectionRepository: MonthProjectionRepository,
    private readonly workspaceTimezone: GetWorkspaceTimezoneService,
    private readonly dateProvider: DateProvider,
    private readonly resolveSuggestion: ResolveBudgetSuggestionService,
  ) {}

  async execute({
    workspaceId,
    month,
    year,
    today,
  }: Request): Promise<Either<Error, ResolvedMonthPlan>> {
    const timezone = await this.workspaceTimezone.execute(workspaceId);
    const key = `${year}-${String(month).padStart(2, '0')}`;
    const referenceDate = `${key}-01`;
    const start = this.dateProvider.startOfMonth(referenceDate, timezone);

    const snapshot = await this.budgetRepository.resolveSnapshot(
      workspaceId,
      start,
    );
    const declaredCents = (snapshot?.allocations ?? []).reduce(
      (total, { targetCents }) => total + targetCents,
      0,
    );
    if (snapshot && declaredCents > 0) {
      return right({
        source: 'declared',
        planTotalCents: declaredCents,
        snapshot,
      });
    }

    if (!today.startsWith(key)) return right({ source: 'none' });

    const window = {
      key,
      start,
      end: this.dateProvider.endOfMonth(referenceDate, timezone),
      days: daysInMonth(year, month),
      today,
    };
    const { suggestion, failed } = await this.suggestionOf(workspaceId);
    if (suggestion?.plan && canSuggest(suggestion)) {
      return right({
        source: 'suggested',
        planTotalCents: suggestion.plan.planTotalCents,
        spentCents: await this.spentOf(workspaceId, timezone, window),
        basisMonths: suggestion.plan.basisMonths,
      });
    }

    const fallback = await this.provisionalPlanOf(
      workspaceId,
      timezone,
      window,
    );
    return right(failed ? { ...fallback, degraded: true } : fallback);
  }

  private async suggestionOf(workspaceId: string): Promise<SuggestionOutcome> {
    try {
      const result = await this.resolveSuggestion.execute({ workspaceId });
      if (result.isLeft()) throw result.value;

      return { suggestion: result.value, failed: false };
    } catch (error) {
      this.logger.error(
        `suggested plan unavailable, using provisional workspaceId=${workspaceId} error=${describeError(error)}`,
      );
      captureException(error, { extra: { workspaceId } });
      return { suggestion: null, failed: true };
    }
  }

  private async spentOf(
    workspaceId: string,
    timezone: string,
    { start, end }: MonthWindow,
  ): Promise<number> {
    const rows = await this.budgetRepository.findCompletedExpenseByLocalDay({
      workspaceId,
      start,
      end,
      timezone,
    });

    return sum(rows.map(({ totalCents }) => totalCents));
  }

  private async provisionalPlanOf(
    workspaceId: string,
    timezone: string,
    window: MonthWindow,
  ): Promise<ResolvedMonthPlan> {
    const { start, end } = window;
    const lookbackStart = this.dateProvider.startOfMonth(
      this.dateProvider.add(start, -LOOKBACK_MONTHS, 'month', timezone),
      timezone,
    );

    const [spentRows, rules, ledger] = await Promise.all([
      this.budgetRepository.findCompletedExpenseByLocalDay({
        workspaceId,
        start,
        end,
        timezone,
      }),
      this.monthProjectionRepository.findActiveRecurringRules(workspaceId, {
        start,
        end,
      }),
      this.monthProjectionRepository.findMonthLedger({
        workspaceId,
        timezone,
        range: { start: lookbackStart, end },
        currentMonthStart: start,
      }),
    ]);

    const spentCents = sum(spentRows.map(({ totalCents }) => totalCents));
    const recurringDueCents = this.recurringDueOf(rules, window);
    const plan = buildProvisionalPlan({
      today: window.today,
      daysInMonth: window.days,
      expenses: completedPlainExpensesOf(ledger),
      spentCents,
      recurringExpenseCents: this.recurringExpenseOf(rules, window, timezone),
      recurringDueCents,
    });
    if (plan.kind === 'nothing-observed') {
      return { source: 'nothing-observed', recurringDueCents, spentCents };
    }

    return {
      source: 'provisional',
      planTotalCents: plan.planTotalCents,
      basis: plan.basis,
      spentCents,
    };
  }

  private recurringDueOf(
    rules: RecurringRuleSnapshot[],
    { key, start, end, days }: MonthWindow,
  ): number {
    return sumNotYetGeneratedOccurrences({
      month: { key, start, end, days },
      recurringRules: rules,
      nextOccurrence: this.nextOccurrenceOf(),
    }).totalExpense;
  }

  private recurringExpenseOf(
    rules: RecurringRuleSnapshot[],
    { start, end }: MonthWindow,
    timezone: string,
  ): number {
    return sum(
      Object.values(
        expenseOccurrencesByDay({
          rules,
          month: { start, end },
          nextOccurrence: this.nextOccurrenceOf(),
          dayOf: (date) =>
            Number(this.dateProvider.format(date, 'D', timezone)),
        }),
      ),
    );
  }

  private nextOccurrenceOf() {
    return (date: Date, rule: RecurringRuleSnapshot): Date =>
      nextOccurrenceAfter(
        {
          startDate: rule.startDate,
          frequency: rule.frequency,
          interval: rule.interval,
          timezone: rule.timezone,
        },
        date,
        this.dateProvider,
      );
  }
}
