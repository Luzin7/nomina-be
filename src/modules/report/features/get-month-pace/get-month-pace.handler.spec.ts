import { RecurrenceFrequency, TransactionType } from '@constants/enums';
import { INVESTMENTS_CATEGORY_NAME } from '@constants/incomeCategories';
import { BudgetRepository } from '@modules/budget/repositories/contracts/BudgetRepository';
import {
  ResolveBudgetSuggestionService,
  type BudgetSuggestion,
} from '@modules/budget/services/resolve-budget-suggestion.service';
import { left, right } from '@shared/core/errors/Either';
import { MonthProjectionRepository } from '@modules/report/repositories/contracts/MonthProjectionRepository';
import { RecurringRuleSnapshot } from '@modules/report/valueObjects/MonthProjection';
import { GetWorkspaceTimezoneService } from '@modules/workspace/services/get-workspace-timezone.service';
import { Logger } from '@nestjs/common';
import { DateProvider } from '@providers/date/contracts/DateProvider';
import { DayJsDateProvider } from '@providers/date/implementations/Dayjs';
import { LEDGER_LIVE_CACHE_TTL_SECONDS } from '@shared/cache/report-cache';
import { InMemoryCacheProvider } from '@shared/cache/test-helpers/in-memory-cache';
import { ResolveMonthPlanService } from '../../services/resolve-month-plan.service';
import { GetMonthPaceService } from './get-month-pace.handler';

jest.mock('@sentry/nestjs', () => ({ captureException: jest.fn() }));

const WORKSPACE_ID = 'ws-1';
const SAO_PAULO = 'America/Sao_Paulo';
const NOW = new Date('2026-11-15T15:00:00.000Z');

function makeSnapshot(totalTargetCents: number) {
  return {
    id: 'snapshot-1',
    workspaceId: WORKSPACE_ID,
    effectiveFrom: new Date('2026-11-01T03:00:00.000Z'),
    monthlyIncome: 1_000_000,
    mode: 'fixed',
    allocations: [
      {
        id: 'allocation-1',
        categoryId: 'cat-1',
        categoryName: 'Moradia',
        targetCents: totalTargetCents - 100,
      },
      {
        id: 'allocation-2',
        categoryId: 'cat-2',
        categoryName: 'Lazer',
        targetCents: 100,
      },
    ],
  };
}

const allocationOf = (
  categoryId: string,
  categoryName: string,
  targetCents: number,
) => ({
  id: `allocation-${categoryId}`,
  categoryId,
  categoryName,
  groupName: 'Plano',
  groupOrder: 0,
  categoryOrder: 0,
  percentageOfIncome: 0,
  targetCents,
});

const NO_SUGGESTION: BudgetSuggestion = {
  month: '2026-11',
  monthStart: new Date('2026-11-01T03:00:00.000Z'),
  basisMonths: 0,
  income: { status: 'unavailable' },
  split: { status: 'unavailable' },
  plan: null,
  planEligible: false,
};

function makeRentRule(): RecurringRuleSnapshot {
  return {
    id: 'rent',
    type: 'EXPENSE',
    categoryId: null,
    amount: 300_000,
    frequency: RecurrenceFrequency.MONTHLY,
    interval: 1,
    startDate: new Date('2026-09-05T15:00:00.000Z'),
    endDate: null,
    lastGenerated: null,
    materializedDates: [],
  };
}

describe('GetMonthPaceService', () => {
  let service: GetMonthPaceService;
  let budgetRepository: jest.Mocked<BudgetRepository>;
  let monthProjectionRepository: jest.Mocked<MonthProjectionRepository>;
  let workspaceTimezone: jest.Mocked<GetWorkspaceTimezoneService>;
  let dateProvider: DateProvider;
  let cache: InMemoryCacheProvider;
  let resolveSuggestion: jest.Mocked<ResolveBudgetSuggestionService>;

  beforeEach(() => {
    budgetRepository = {
      resolveSnapshot: jest.fn().mockResolvedValue(makeSnapshot(876_000)),
      findCompletedExpenseByLocalDay: jest.fn().mockResolvedValue([]),
      findCategoryMap: jest.fn().mockResolvedValue({}),
      findCompletedExpenseByCategoryDay: jest.fn().mockResolvedValue([]),
    } as unknown as jest.Mocked<BudgetRepository>;
    monthProjectionRepository = {
      findActiveRecurringRules: jest.fn().mockResolvedValue([]),
      findMonthLedger: jest.fn().mockResolvedValue([]),
    } as unknown as jest.Mocked<MonthProjectionRepository>;
    workspaceTimezone = {
      execute: jest.fn().mockResolvedValue(SAO_PAULO),
    } as unknown as jest.Mocked<GetWorkspaceTimezoneService>;
    dateProvider = new DayJsDateProvider();
    jest.spyOn(dateProvider, 'now').mockReturnValue(NOW);
    cache = new InMemoryCacheProvider();
    resolveSuggestion = {
      execute: jest.fn().mockResolvedValue(right(NO_SUGGESTION)),
    } as unknown as jest.Mocked<ResolveBudgetSuggestionService>;

    service = new GetMonthPaceService(
      new ResolveMonthPlanService(
        budgetRepository,
        monthProjectionRepository,
        workspaceTimezone,
        dateProvider,
        resolveSuggestion,
      ),
      budgetRepository,
      monthProjectionRepository,
      workspaceTimezone,
      dateProvider,
      cache,
    );
  });

  afterEach(() => jest.restoreAllMocks());

  async function run(month = 11, year = 2026) {
    const result = await service.execute({
      workspaceId: WORKSPACE_ID,
      month,
      year,
    });
    if (result.isLeft()) throw result.value;
    return result.value;
  }

  it('returns daysInMonth days with spentCents null after today', async () => {
    const pace = await run();

    expect(pace.month).toBe('2026-11');
    expect(pace.daysInMonth).toBe(30);
    expect(pace.today).toBe(15);
    expect(pace.days).toHaveLength(30);
    expect(pace.days[14].spentCents).not.toBeNull();
    expect(pace.days[15].spentCents).toBeNull();
  });

  it('ends the plan at planTotalCents', async () => {
    const pace = await run();

    expect(pace.planTotalCents).toBe(876_000);
    expect(pace.days[29].planCents).toBe(876_000);
  });

  it('marks a snapshot plan as declared', async () => {
    const pace = await run();

    expect(pace.planSource).toBe('declared');
  });

  it('nulls the plan fields for a past month without a budget snapshot', async () => {
    budgetRepository.resolveSnapshot.mockResolvedValue(null);

    const pace = await run(10);

    expect(pace.planTotalCents).toBeNull();
    expect(pace.planSource).toBeNull();
    expect(pace.days.every((entry) => entry.planCents === null)).toBe(true);
  });

  it('nulls the plan fields in the current month when nothing was observed', async () => {
    budgetRepository.resolveSnapshot.mockResolvedValue(null);

    const pace = await run();

    expect(pace.planTotalCents).toBeNull();
    expect(pace.planSource).toBeNull();
  });

  it('plans provisionally in the current month without a snapshot', async () => {
    budgetRepository.resolveSnapshot.mockResolvedValue(null);
    monthProjectionRepository.findMonthLedger.mockResolvedValue([
      {
        key: '2026-11',
        totalIncome: 0,
        totalExpense: 0,
        pending: { totalIncome: 0, totalExpense: 0 },
        completedCount: 0,
        plainExpenses: [
          { day: 14, categoryId: 'c', amount: 7_000, pending: false },
        ],
      },
    ]);
    budgetRepository.findCompletedExpenseByLocalDay.mockResolvedValue([
      { day: 14, totalCents: 7_000 },
    ]);

    const pace = await run();

    expect(pace.planSource).toBe('provisional');
    expect(pace.planTotalCents).toBe(7_000 + 1_000 * 15);
    expect(pace.days[29].planCents).toBe(pace.planTotalCents);
  });

  it('plans the suggested plan in the current month without a snapshot', async () => {
    budgetRepository.resolveSnapshot.mockResolvedValue(null);
    resolveSuggestion.execute.mockResolvedValue(
      right({
        ...NO_SUGGESTION,
        basisMonths: 3,
        planEligible: true,
        plan: { allocations: [], planTotalCents: 450_000, basisMonths: 3 },
      }),
    );

    const pace = await run();

    expect(pace.planSource).toBe('suggested');
    expect(pace.planTotalCents).toBe(450_000);
    expect(pace.days[29].planCents).toBe(450_000);
  });

  it('keeps a past month without a snapshot null even with spending', async () => {
    budgetRepository.resolveSnapshot.mockResolvedValue(null);
    budgetRepository.findCompletedExpenseByLocalDay.mockResolvedValue([
      { day: 14, totalCents: 7_000 },
    ]);

    const pace = await run(10);

    expect(pace.planSource).toBeNull();
  });

  it('makes the plan jump on the day of a rent rule', async () => {
    monthProjectionRepository.findActiveRecurringRules.mockResolvedValue([
      makeRentRule(),
    ]);

    const pace = await run();

    expect(pace.days[4].planCents! - pace.days[3].planCents!).toBeGreaterThan(
      300_000,
    );
    expect(pace.days[5].planCents! - pace.days[4].planCents!).toBeLessThan(
      30_000,
    );
  });

  it('sets today to the last day in a past month', async () => {
    const pace = await run(10);

    expect(pace.today).toBe(31);
    expect(pace.days[30].spentCents).toBe(0);
  });

  it('sets today to zero in a future month', async () => {
    const pace = await run(12);

    expect(pace.today).toBe(0);
    expect(pace.days.every((entry) => entry.spentCents === null)).toBe(true);
  });

  it('uses the workspace timezone for today', async () => {
    jest
      .spyOn(dateProvider, 'now')
      .mockReturnValue(new Date('2026-12-01T02:30:00.000Z'));

    const pace = await run(11);

    expect(pace.today).toBe(30);
  });

  it('counts spend by workspace-local day', async () => {
    budgetRepository.findCompletedExpenseByLocalDay.mockResolvedValue([
      { day: 14, totalCents: 700 },
      { day: 15, totalCents: 300 },
    ]);

    const pace = await run();

    expect(pace.days[13].spentCents).toBe(700);
    expect(pace.days[14].spentCents).toBe(1_000);
  });

  it('reads the month bounds in the workspace timezone', async () => {
    await run();

    expect(
      budgetRepository.findCompletedExpenseByLocalDay,
    ).toHaveBeenCalledWith({
      workspaceId: WORKSPACE_ID,
      timezone: SAO_PAULO,
      start: new Date('2026-11-01T03:00:00.000Z'),
      end: new Date('2026-12-01T02:59:59.999Z'),
    });
  });

  it('serves the second call from the cache with the live ttl', async () => {
    await run();
    await run();

    expect(
      budgetRepository.findCompletedExpenseByCategoryDay,
    ).toHaveBeenCalledTimes(1);
    expect([...cache.ttls.values()]).toEqual([LEDGER_LIVE_CACHE_TTL_SECONDS]);
  });

  it('keys the cache by ledger and category generation, month and local day', async () => {
    await run();

    expect([...cache.values.keys()]).toEqual([
      expect.stringMatching(
        /^report:month-pace:v6:ws-1:g\d+:c\d+:2026-11:2026-11-15$/,
      ),
    ]);
  });

  it('caches a pace built on a failed suggestion for 60 seconds', async () => {
    budgetRepository.resolveSnapshot.mockResolvedValue(null);
    jest.spyOn(Logger.prototype, 'error').mockImplementation();
    resolveSuggestion.execute.mockResolvedValue(left(new Error('down')));

    const pace = await run();

    expect(pace.planSource).not.toBe('suggested');
    expect([...cache.ttls.values()]).toEqual([60]);
  });

  it('recomputes after the category generation moves', async () => {
    await run();
    await cache.incrementCounter('cache-gen:category:ws-1', Date.now());
    await run();

    expect(
      budgetRepository.findCompletedExpenseByCategoryDay,
    ).toHaveBeenCalledTimes(2);
  });

  it('recomputes after the ledger generation moves', async () => {
    await run();
    await cache.incrementCounter('cache-gen:report:ws-1', Date.now());
    await run();

    expect(
      budgetRepository.findCompletedExpenseByCategoryDay,
    ).toHaveBeenCalledTimes(2);
  });

  it('carries the controlled curve without the Investimentos spend', async () => {
    const investRoot = 'invest-root';
    budgetRepository.resolveSnapshot.mockResolvedValue({
      id: 'snapshot-1',
      workspaceId: WORKSPACE_ID,
      effectiveFrom: new Date('2026-11-01T03:00:00.000Z'),
      monthlyIncome: 1_000_000,
      mode: 'fixed',
      allocations: [
        allocationOf('cat-1', 'Moradia', 60_000),
        allocationOf('cat-2', 'Lazer', 40_000),
        allocationOf(investRoot, 'Investimentos', 10_000),
      ],
    });
    budgetRepository.findCategoryMap.mockResolvedValue({
      'cat-1': {
        name: 'Moradia',
        type: TransactionType.EXPENSE,
        parentId: null,
        isHidden: false,
      },
      'cat-2': {
        name: 'Lazer',
        type: TransactionType.EXPENSE,
        parentId: null,
        isHidden: false,
      },
      'cat-aporte': {
        name: 'Aporte',
        type: TransactionType.EXPENSE,
        parentId: investRoot,
        isHidden: false,
      },
      [investRoot]: {
        name: INVESTMENTS_CATEGORY_NAME,
        type: TransactionType.EXPENSE,
        parentId: null,
        isHidden: false,
      },
    });
    budgetRepository.findCompletedExpenseByCategoryDay.mockResolvedValue([
      { day: 3, categoryId: 'cat-1', totalCents: 2_000 },
      { day: 3, categoryId: 'cat-aporte', totalCents: 5_000 },
    ]);
    budgetRepository.findCompletedExpenseByLocalDay.mockResolvedValue([
      { day: 3, totalCents: 7_000 },
    ]);

    const pace = await run();

    expect(pace.controlledPlanTotalCents).toBe(100_000);
    expect(pace.days[2].controlledSpentCents).toBe(2_000);
    expect(pace.days[2].spentCents).toBe(7_000);
    expect(pace.days[29].controlledPlanCents).toBe(100_000);
    expect(pace.days[29].planCents).toBe(110_000);
  });

  it('reads the budget snapshot once for a declared plan', async () => {
    budgetRepository.resolveSnapshot.mockResolvedValue({
      id: 'snapshot-1',
      workspaceId: WORKSPACE_ID,
      effectiveFrom: new Date('2026-11-01T03:00:00.000Z'),
      monthlyIncome: 1_000_000,
      mode: 'fixed',
      allocations: [
        allocationOf('cat-1', 'Moradia', 60_000),
        allocationOf('cat-2', 'Lazer', 40_000),
      ],
    });
    budgetRepository.findCategoryMap.mockResolvedValue({
      'cat-1': {
        name: 'Moradia',
        type: TransactionType.EXPENSE,
        parentId: null,
        isHidden: false,
      },
      'cat-2': {
        name: 'Lazer',
        type: TransactionType.EXPENSE,
        parentId: null,
        isHidden: false,
      },
    });

    const pace = await run();

    expect(budgetRepository.resolveSnapshot).toHaveBeenCalledTimes(1);
    expect(pace.controlledPlanTotalCents).toBe(100_000);
  });

  it('nulls the controlled curve when the plan is not declared', async () => {
    budgetRepository.resolveSnapshot.mockResolvedValue(null);

    const pace = await run();

    expect(pace.controlledPlanTotalCents).toBeNull();
    expect(pace.days.every((day) => day.controlledSpentCents === null)).toBe(
      true,
    );
    expect(pace.days.every((day) => day.controlledPlanCents === null)).toBe(
      true,
    );
  });
});
