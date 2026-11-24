import { CacheProvider } from '@infra/cache/contracts/CacheProvider';
import { readCategoryGeneration } from '@modules/category/services/category-list-cache';
import {
  BudgetRepository,
  type BudgetSnapshot,
  type CompletedExpenseOfCategoryDay,
} from '@modules/budget/repositories/contracts/BudgetRepository';
import { attributeSpendToAllocations } from '@modules/budget/valueObjects/BudgetSpendAttribution';
import {
  controlledCategoryIdsOf,
  controlledRootIdsOf,
  parentMapOf,
  resolveInvestmentsRootId,
  rootOf,
} from '@modules/budget/valueObjects/BudgetPlanSides';
import { MonthProjectionRepository } from '@modules/report/repositories/contracts/MonthProjectionRepository';
import {
  buildMonthPace,
  expenseOccurrencesByDay,
  MonthPace,
  MonthPlanSource,
  type ControlledPace,
} from '@modules/report/valueObjects/MonthPace';
import type { RecurringRuleSnapshot } from '@modules/report/valueObjects/MonthProjection';
import { GetWorkspaceTimezoneService } from '@modules/workspace/services/get-workspace-timezone.service';
import { Injectable } from '@nestjs/common';
import { TokenPayloadSchema } from '@providers/auth/strategys/jwtStrategy';
import { DateProvider } from '@providers/date/contracts/DateProvider';
import { buildCacheKey } from '@shared/cache/cache-key';
import { readThrough } from '@shared/cache/read-through';
import {
  LEDGER_LIVE_CACHE_TTL_SECONDS,
  readLedgerGeneration,
} from '@shared/cache/report-cache';
import { Service } from '@shared/core/contracts/Service';
import { Either, left, right } from '@shared/core/errors/Either';
import { nextOccurrenceAfter } from '@utils/installmentSchedule';
import { daysInMonth } from '@utils/calendarMonth';
import {
  ResolveMonthPlanService,
  type ResolvedMonthPlan,
} from '../../services/resolve-month-plan.service';
import { GetMonthPaceRequest } from './get-month-pace.dto';

type Request = GetMonthPaceRequest & Pick<TokenPayloadSchema, 'workspaceId'>;

type PaceWindow = {
  workspaceId: string;
  start: Date;
  end: Date;
  timezone: string;
};

type ControlledSpendInput = {
  rows: CompletedExpenseOfCategoryDay[];
  parentByCategory: Record<string, string | null>;
  allocatedCategoryIds: Set<string>;
  controlledCategoryIds: Set<string>;
};

const DEGRADED_CACHE_TTL_SECONDS = 60;

type ComputedMonthPace = { pace: MonthPace; degraded: boolean };

const planFieldsOf = (
  plan: ResolvedMonthPlan,
): { planTotalCents: number | null; planSource: MonthPlanSource | null } => {
  if (
    plan.source === 'declared' ||
    plan.source === 'suggested' ||
    plan.source === 'provisional'
  ) {
    return { planTotalCents: plan.planTotalCents, planSource: plan.source };
  }

  return { planTotalCents: null, planSource: null };
};

const controlledSpentOf = (
  spentByAllocation: Record<string, number>,
  controlledCategoryIds: Set<string>,
): number =>
  Object.entries(spentByAllocation).reduce(
    (total, [categoryId, cents]) =>
      controlledCategoryIds.has(categoryId) ? total + cents : total,
    0,
  );

@Injectable()
export class GetMonthPaceService implements Service<Request, Error, MonthPace> {
  constructor(
    private readonly resolveMonthPlan: ResolveMonthPlanService,
    private readonly budgetRepository: BudgetRepository,
    private readonly monthProjectionRepository: MonthProjectionRepository,
    private readonly workspaceTimezone: GetWorkspaceTimezoneService,
    private readonly dateProvider: DateProvider,
    private readonly cache: CacheProvider,
  ) {}

  async execute(request: Request): Promise<Either<Error, MonthPace>> {
    const { workspaceId, month, year } = request;
    const [ledger, category, timezone] = await Promise.all([
      readLedgerGeneration(this.cache, workspaceId),
      readCategoryGeneration(this.cache, workspaceId),
      this.workspaceTimezone.execute(workspaceId),
    ]);
    const now = this.dateProvider.now();

    const result = await readThrough({
      cache: this.cache,
      key: buildCacheKey({
        route: 'report:month-pace',
        version: 'v6',
        workspaceId,
        generations: { ledger, category },
        parts: [
          `${year}-${month}`,
          this.dateProvider.format(now, 'YYYY-MM-DD', timezone),
        ],
      }),
      ttlSeconds: LEDGER_LIVE_CACHE_TTL_SECONDS,
      load: () => this.compute(request, now, timezone),
      ttlFor: ({ degraded }) =>
        degraded ? DEGRADED_CACHE_TTL_SECONDS : LEDGER_LIVE_CACHE_TTL_SECONDS,
    });
    if (result.isLeft()) return left(result.value);

    return right(result.value.pace);
  }

  private async compute(
    { workspaceId, month, year }: Request,
    now: Date,
    timezone: string,
  ): Promise<Either<Error, ComputedMonthPace>> {
    const monthKey = `${year}-${String(month).padStart(2, '0')}`;
    const referenceDate = `${monthKey}-01`;
    const window: PaceWindow = {
      workspaceId,
      start: this.dateProvider.startOfMonth(referenceDate, timezone),
      end: this.dateProvider.endOfMonth(referenceDate, timezone),
      timezone,
    };
    const totalDays = daysInMonth(year, month);
    const recurringWindow = {
      start: this.dateProvider.add(window.start, -2, 'day', timezone),
      end: this.dateProvider.add(window.end, 2, 'day', timezone),
    };

    const [plan, spentRows, rules] = await Promise.all([
      this.resolveMonthPlan.execute({
        workspaceId,
        month,
        year,
        today: this.dateProvider.format(now, 'YYYY-MM-DD', timezone),
      }),
      this.budgetRepository.findCompletedExpenseByLocalDay(window),
      this.monthProjectionRepository.findActiveRecurringRules(
        workspaceId,
        recurringWindow,
      ),
    ]);

    if (plan.isLeft()) return left(plan.value);

    const controlled =
      plan.value.source === 'declared'
        ? await this.controlledPaceOf(window, rules, plan.value.snapshot)
        : null;

    return right({
      degraded: 'degraded' in plan.value && plan.value.degraded === true,
      pace: buildMonthPace({
        month: monthKey,
        daysInMonth: totalDays,
        today: this.resolveToday(monthKey, now, timezone, totalDays),
        spentByDay: Object.fromEntries(
          spentRows.map(({ day, totalCents }) => [day, totalCents]),
        ),
        ...planFieldsOf(plan.value),
        fixedByDay: this.occurrencesByDay(rules, window),
        controlled,
      }),
    });
  }

  private async controlledPaceOf(
    window: PaceWindow,
    rules: RecurringRuleSnapshot[],
    snapshot: BudgetSnapshot,
  ): Promise<ControlledPace> {
    const { workspaceId } = window;

    const [categoryMap, rows] = await Promise.all([
      this.budgetRepository.findCategoryMap(workspaceId),
      this.budgetRepository.findCompletedExpenseByCategoryDay(window),
    ]);
    const parentByCategory = parentMapOf(categoryMap);
    const investRootCategoryId = resolveInvestmentsRootId(categoryMap);
    const allocations = snapshot.allocations.filter(
      ({ categoryName }) => categoryName !== null,
    );
    const controlledCategoryIds = controlledCategoryIdsOf(
      allocations,
      parentByCategory,
      investRootCategoryId,
    );
    const controlledRootIds = controlledRootIdsOf(
      allocations,
      parentByCategory,
      investRootCategoryId,
    );

    return {
      planTotalCents: allocations
        .filter(({ categoryId }) => controlledCategoryIds.has(categoryId))
        .reduce((total, { targetCents }) => total + targetCents, 0),
      spentByDay: this.controlledSpendByDay({
        rows,
        parentByCategory,
        allocatedCategoryIds: new Set(
          allocations.map(({ categoryId }) => categoryId),
        ),
        controlledCategoryIds,
      }),
      fixedByDay: this.occurrencesByDay(
        rules.filter(
          ({ categoryId }) =>
            categoryId === null ||
            controlledRootIds.has(rootOf(categoryId, parentByCategory)),
        ),
        window,
      ),
    };
  }

  private controlledSpendByDay({
    rows,
    parentByCategory,
    allocatedCategoryIds,
    controlledCategoryIds,
  }: ControlledSpendInput): Record<number, number> {
    const categorySpendByDay = new Map<number, Record<string, number>>();

    for (const { day, categoryId, totalCents } of rows) {
      const spend = categorySpendByDay.get(day) ?? {};
      spend[categoryId] = (spend[categoryId] ?? 0) + totalCents;
      categorySpendByDay.set(day, spend);
    }

    const byDay: Record<number, number> = {};
    for (const [day, spend] of categorySpendByDay) {
      const { spentByAllocation } = attributeSpendToAllocations(
        spend,
        parentByCategory,
        allocatedCategoryIds,
      );
      byDay[day] = controlledSpentOf(spentByAllocation, controlledCategoryIds);
    }

    return byDay;
  }

  private occurrencesByDay(
    rules: RecurringRuleSnapshot[],
    { start, timezone }: PaceWindow,
  ): Record<number, number> {
    const referenceDate = `${this.dateProvider.format(
      start,
      'YYYY-MM',
      timezone,
    )}-01`;
    const byDay: Record<number, number> = {};

    for (const rule of rules) {
      const occurrences = this.ruleOccurrences(rule, referenceDate);
      for (const [day, amount] of Object.entries(occurrences)) {
        byDay[Number(day)] = (byDay[Number(day)] ?? 0) + amount;
      }
    }

    return byDay;
  }

  private ruleOccurrences(
    rule: RecurringRuleSnapshot,
    referenceDate: string,
  ): Record<number, number> {
    return expenseOccurrencesByDay({
      rules: [rule],
      month: {
        start: this.dateProvider.startOfMonth(referenceDate, rule.timezone),
        end: this.dateProvider.endOfMonth(referenceDate, rule.timezone),
      },
      nextOccurrence: (date) =>
        nextOccurrenceAfter(
          {
            startDate: rule.startDate,
            frequency: rule.frequency,
            interval: rule.interval,
            timezone: rule.timezone,
          },
          date,
          this.dateProvider,
        ),
      dayOf: (date) =>
        Number(this.dateProvider.format(date, 'D', rule.timezone)),
    });
  }

  private resolveToday(
    monthKey: string,
    now: Date,
    timezone: string,
    totalDays: number,
  ): number {
    const currentKey = this.dateProvider.format(now, 'YYYY-MM', timezone);
    if (monthKey > currentKey) return 0;
    if (monthKey < currentKey) return totalDays;

    return Number(this.dateProvider.format(now, 'D', timezone));
  }
}
