import { InMemoryCacheProvider } from '@shared/cache/test-helpers/in-memory-cache';
import { makeCreditCard } from '@modules/account/test-helpers/mock-factories';
import { ListAccountsService } from '@modules/account/features/list-accounts/list-accounts.service';
import { GetCreditCardInvoiceService } from '@modules/account/features/get-credit-card-invoice/get-credit-card-invoice.handler';
import { BudgetRepository } from '@modules/budget/repositories/contracts/BudgetRepository';
import {
  BudgetStatusAllocation,
  BudgetStatusResponse,
  GetBudgetStatusService,
} from '@modules/budget/features/get-status/get-status.handler';
import { MonthProjectionRepository } from '@modules/report/repositories/contracts/MonthProjectionRepository';
import { GoalRepository } from '@modules/goal/repositories/contracts/GoalRepository';
import {
  ResolveBudgetSuggestionService,
  type BudgetSuggestion,
} from '@modules/budget/services/resolve-budget-suggestion.service';
import { ResolveMonthPlanService } from '@modules/report/services/resolve-month-plan.service';
import type { ResolvedMonthPlan } from '@modules/report/services/resolve-month-plan.service';
import type { ProvisionalBasis } from '@modules/report/valueObjects/ProvisionalPlan';
import { FindMonthSummaryService } from '@modules/report/features/get-month-summary/get-month-summary.service';
import { GetProjectionService } from '@modules/report/features/get-projection/get-projection.handler';
import { MonthProjection } from '@modules/report/valueObjects/MonthProjection';
import { MonthSummary } from '@modules/report/valueObjects/MonthSummary';
import { HorizonMonth } from '@modules/report/valueObjects/ProjectionHorizon';
import { GetWorkspaceTimezoneService } from '@modules/workspace/services/get-workspace-timezone.service';
import { Logger } from '@nestjs/common';
import { DayJsDateProvider } from '@providers/date/implementations/Dayjs';
import { left, right } from '@shared/core/errors/Either';
import { CardBillDueInsightService } from '../../services/card-bill-due-insight.service';
import { BudgetSuggestionInsightService } from '../../services/budget-suggestion-insight.service';
import { ProjectionShortfallInsightService } from '../../services/projection-shortfall-insight.service';
import { GetAvailableToSpendService } from './get-available-to-spend.handler';

const TIMEZONE = 'America/Sao_Paulo';
const NOW = new Date('2026-11-15T12:00:00.000Z');
const REQUEST = { workspaceId: 'ws-1', sub: 'user-1' };

const NO_SUGGESTION: BudgetSuggestion = {
  month: '2026-11',
  monthStart: new Date('2026-11-01T03:00:00.000Z'),
  basisMonths: 0,
  income: { status: 'unavailable' },
  split: { status: 'unavailable' },
};

const makeProjection = (
  overrides: Partial<MonthProjection> = {},
): MonthProjection => ({
  expectedIncome: 0,
  expectedExpense: 0,
  expectedBalance: 0,
  realized: { totalIncome: 0, totalExpense: 0 },
  scheduled: { totalIncome: 0, totalExpense: 0 },
  recurringNotYetGenerated: { totalIncome: 0, totalExpense: 0 },
  fixedBillsDue: 0,
  accountedExpense: 0,
  variableRemaining: 0,
  paceDaily: 777,
  paceRemaining: null,
  paceBalance: null,
  daysRemaining: 3,
  usualExpense: null,
  basisMonths: 0,
  hasHistory: false,
  ...overrides,
});

const makeSpendProjection = (
  recurringExpense = 0,
  daysRemaining = 3,
): MonthProjection =>
  makeProjection({
    recurringNotYetGenerated: {
      totalIncome: 0,
      totalExpense: recurringExpense,
    },
    daysRemaining,
  });

const makeSummary = (recurringExpense = 0, daysRemaining = 3): MonthSummary =>
  MonthSummary.create({
    month: new Date('2026-11-01T03:00:00.000Z'),
    totalIncome: 0,
    totalExpense: 0,
    totalCheckingBalance: 0,
    totalInvestmentBalance: 0,
    totalCreditCardBalance: 0,
    rate: { currentMonthSaving: 0, previousMonthCompareSaving: 0 },
    previousMonthToDate: { totalIncome: 0, totalExpense: 0 },
    projection: makeSpendProjection(recurringExpense, daysRemaining),
  });

const makeAllocation = (
  overrides: Partial<BudgetStatusAllocation> = {},
): BudgetStatusAllocation => ({
  categoryId: 'cat-1',
  categoryName: 'Moradia',
  groupName: 'Custos fixos',
  targetCents: 1_000,
  spentCents: 500,
  remainingCents: 500,
  percentageOfIncome: 10,
  percentageUsed: 50,
  ...overrides,
});

const makeBreach = (
  categoryId: string,
  categoryName: string,
  overageCents: number,
): BudgetStatusAllocation =>
  makeAllocation({
    categoryId,
    categoryName,
    targetCents: 1_000,
    spentCents: 1_000 + overageCents,
    remainingCents: -overageCents,
    percentageUsed: 150,
  });

const makeBudget = (
  overrides: Partial<Extract<BudgetStatusResponse, { exists: true }>> = {},
): BudgetStatusResponse => ({
  exists: true,
  mode: 'percentage',
  monthlyIncomeCents: 1_500,
  effectiveFrom: new Date('2026-11-01T03:00:00.000Z'),
  allocations: [makeAllocation()],
  pillars: [],
  unallocatedSpent: 0,
  totalTargetCents: 1_500,
  unallocatedIncomeCents: 0,
  allocationState: 'balanced',
  totalSpent: 500,
  projection: makeSpendProjection(),
  ...overrides,
});

const declaredPlanOf = (budget: BudgetStatusResponse): ResolvedMonthPlan =>
  budget.exists && budget.totalTargetCents > 0
    ? { source: 'declared', planTotalCents: budget.totalTargetCents }
    : { source: 'nothing-observed', recurringDueCents: 0, spentCents: 0 };

const makeBasis = (
  overrides: Partial<ProvisionalBasis> = {},
): ProvisionalBasis => ({
  confidence: 'observed',
  frozen: false,
  recurringExpenseCents: 0,
  recurringDueCents: 0,
  dailyRateCents: 1_000,
  observedDays: 14,
  activeDays: 10,
  minActiveDays: 5,
  windowStart: '2026-11-01',
  windowEnd: '2026-11-15',
  ...overrides,
});

const makeHorizonMonth = (
  overrides: Partial<HorizonMonth> = {},
): HorizonMonth =>
  ({
    key: '2026-11',
    status: 'ok',
    shortfallCents: 0,
    pendingInstallments: [],
    ...overrides,
  }) as HorizonMonth;

const makeInvoice = (overrides: Record<string, unknown> = {}) => ({
  invoiceStatus: 'closed',
  totalAmount: 10_000n,
  transactions: [],
  ...overrides,
});

describe('GetAvailableToSpendService', () => {
  let service: GetAvailableToSpendService;
  let cache: InMemoryCacheProvider;
  let getBudgetStatus: jest.Mocked<GetBudgetStatusService>;
  let resolveMonthPlan: jest.Mocked<ResolveMonthPlanService>;
  let findMonthSummary: jest.Mocked<FindMonthSummaryService>;
  let goalRepository: jest.Mocked<GoalRepository>;
  let listAccounts: jest.Mocked<ListAccountsService>;
  let getInvoice: jest.Mocked<GetCreditCardInvoiceService>;
  let getProjection: jest.Mocked<GetProjectionService>;
  let resolveSuggestion: jest.Mocked<ResolveBudgetSuggestionService>;
  let warn: jest.SpyInstance;

  let currentBudget: BudgetStatusResponse;
  const givenBudget = (budget: BudgetStatusResponse) => {
    currentBudget = budget;
    getBudgetStatus.execute.mockResolvedValue(right(budget));
    givenPlan(declaredPlanOf(budget));
  };
  const givenPlan = (plan: ResolvedMonthPlan) =>
    resolveMonthPlan.execute.mockResolvedValue(right(plan));
  const givenProjection = (recurringExpense: number, daysRemaining = 3) => {
    if (!currentBudget.exists) throw new Error('budget snapshot required');
    givenBudget({
      ...currentBudget,
      projection: makeSpendProjection(recurringExpense, daysRemaining),
    });
  };
  const givenSummary = (summary: MonthSummary) =>
    findMonthSummary.execute.mockResolvedValue(right(summary));
  const givenAccounts = (...accounts: unknown[]) =>
    listAccounts.execute.mockResolvedValue(
      right({
        accounts: accounts.map((account) => ({
          account,
          balanceUpdatedAt: null,
        })),
        total: accounts.length,
      } as never),
    );
  const givenHorizon = (...months: HorizonMonth[]) =>
    getProjection.execute.mockResolvedValue(
      right({
        projection: { openingBalanceCents: 0, months },
        horizon: 3,
        generatedAt: NOW,
      }),
    );
  const givenInvoice = (invoice = makeInvoice()) =>
    getInvoice.execute.mockResolvedValue(right(invoice as never));
  const dueIn = (days: number, overrides = {}) =>
    makeCreditCard({
      id: 'card-1',
      name: 'Nubank',
      dueDay: 15 + days,
      ...overrides,
    });

  const makeBudgetSuggestionInsight = () =>
    new BudgetSuggestionInsightService(resolveSuggestion);

  const givenPendingIncomeSuggestion = () =>
    resolveSuggestion.execute.mockResolvedValue(
      right({
        ...NO_SUGGESTION,
        income: {
          status: 'pending',
          incomeCents: 500_000,
          base: 'median',
          incomeMonths: 3,
          zeroIncomeMonths: 0,
          fingerprint: 'income',
        },
      }),
    );

  beforeEach(() => {
    getBudgetStatus = {
      execute: jest.fn(),
    } as unknown as jest.Mocked<GetBudgetStatusService>;
    findMonthSummary = {
      execute: jest.fn(),
    } as unknown as jest.Mocked<FindMonthSummaryService>;
    resolveMonthPlan = {
      execute: jest.fn(),
    } as unknown as jest.Mocked<ResolveMonthPlanService>;
    goalRepository = {
      sumMonthlyAporteCents: jest.fn().mockResolvedValue(0),
    } as unknown as jest.Mocked<GoalRepository>;
    listAccounts = {
      execute: jest.fn(),
    } as unknown as jest.Mocked<ListAccountsService>;
    getInvoice = {
      execute: jest.fn(),
    } as unknown as jest.Mocked<GetCreditCardInvoiceService>;
    getProjection = {
      execute: jest.fn(),
    } as unknown as jest.Mocked<GetProjectionService>;
    resolveSuggestion = {
      execute: jest.fn().mockResolvedValue(right(NO_SUGGESTION)),
    } as unknown as jest.Mocked<ResolveBudgetSuggestionService>;
    const workspaceTimezone = {
      execute: jest.fn().mockResolvedValue(TIMEZONE),
    } as unknown as GetWorkspaceTimezoneService;
    const dateProvider = new DayJsDateProvider();
    jest.spyOn(dateProvider, 'now').mockReturnValue(NOW);

    givenBudget(makeBudget());
    givenSummary(makeSummary());
    givenAccounts();
    givenHorizon(makeHorizonMonth());
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();

    cache = new InMemoryCacheProvider();
    service = new GetAvailableToSpendService(
      getBudgetStatus,
      resolveMonthPlan,
      findMonthSummary,
      goalRepository,
      new CardBillDueInsightService(listAccounts, getInvoice),
      new ProjectionShortfallInsightService(getProjection),
      makeBudgetSuggestionInsight(),
      workspaceTimezone,
      dateProvider,
      cache,
    );
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  const run = async () => {
    cache.values.clear();
    const result = await service.execute(REQUEST);
    if (result.isLeft()) throw result.value;
    return result.value;
  };

  describe('figure', () => {
    it('subtracts recurring and goal aportes from the remaining budget', async () => {
      givenBudget(makeBudget({ totalTargetCents: 1_500, totalSpent: 500 }));
      givenProjection(200, 3);
      goalRepository.sumMonthlyAporteCents.mockResolvedValue(300);

      const response = await run();

      expect(response).toMatchObject({
        month: '2026-11',
        daysRemaining: 3,
        budget: {
          exists: true,
          source: 'declared',
          provisional: false,
          totalTargetCents: 1_500,
          totalSpentCents: 500,
        },
        remainingBudgetCents: 1_000,
        reservations: {
          recurringNotYetGeneratedCents: 200,
          goalAportesCents: 300,
        },
        spendableCents: 500,
        perDayCents: 166,
        state: 'within-budget',
      });
    });

    it('keeps negative spendable unclamped with no daily allowance', async () => {
      givenBudget(
        makeBudget({
          totalTargetCents: 1_000,
          totalSpent: 700,
          allocations: [],
        }),
      );
      givenProjection(313);
      goalRepository.sumMonthlyAporteCents.mockResolvedValue(200);

      const response = await run();

      expect(response.spendableCents).toBe(-213);
      expect(response.perDayCents).toBeNull();
      expect(response.state).toBe('over-budget');
    });

    it('has no daily allowance when spendable is zero', async () => {
      givenBudget(makeBudget({ totalTargetCents: 1_000, totalSpent: 500 }));
      givenProjection(500);

      const response = await run();

      expect(response.spendableCents).toBe(0);
      expect(response.perDayCents).toBeNull();
      expect(response.state).toBe('within-budget');
    });

    it('floors the daily allowance and never divides by less than one day', async () => {
      givenBudget(makeBudget({ totalTargetCents: 1_000, totalSpent: 0 }));
      givenProjection(0, 0);

      const response = await run();

      expect(response.perDayCents).toBe(1_000);
    });

    it('uses null instead of zero without a budget snapshot and still computes reservations', async () => {
      givenBudget({ exists: false });
      givenPlan({
        source: 'nothing-observed',
        recurringDueCents: 200,
        spentCents: 0,
      });
      givenSummary(makeSummary(200));
      goalRepository.sumMonthlyAporteCents.mockResolvedValue(300);

      const response = await run();

      expect(response).toEqual({
        month: '2026-11',
        daysRemaining: 3,
        budget: { exists: false, recurringDueCents: 200, totalSpentCents: 0 },
        remainingBudgetCents: null,
        reservations: {
          recurringNotYetGeneratedCents: 200,
          goalAportesCents: 300,
        },
        spendableCents: null,
        perDayCents: null,
        state: 'no-budget',
        insight: null,
      });
    });

    it('does not add unallocated income to spendable', async () => {
      givenBudget(
        makeBudget({
          totalTargetCents: 1_000,
          totalSpent: 0,
          unallocatedIncomeCents: 5_000,
        }),
      );

      const response = await run();

      expect(response.spendableCents).toBe(1_000);
    });

    it('matches the budget status figures for the same month', async () => {
      givenBudget(makeBudget({ totalTargetCents: 4_321, totalSpent: 1_234 }));

      const response = await run();

      expect(response.remainingBudgetCents).toBe(4_321 - 1_234);
      expect(getBudgetStatus.execute).toHaveBeenCalledTimes(1);
      expect(getBudgetStatus.execute).toHaveBeenCalledWith({
        ...REQUEST,
        month: 11,
        year: 2026,
      });
    });

    it('derives the daily allowance from spendable, never from the pace', async () => {
      givenBudget(makeBudget({ totalTargetCents: 1_000, totalSpent: 0 }));

      const response = await run();

      expect(response.perDayCents).toBe(333);
    });

    it('does not read the month summary when the budget carries the projection', async () => {
      await run();

      expect(findMonthSummary.execute).not.toHaveBeenCalled();
    });

    it.each([
      ['with a budget snapshot', () => makeBudget()],
      [
        'without a budget snapshot',
        (): BudgetStatusResponse => ({ exists: false }),
      ],
    ])(
      'computes the month summary exactly once %s',
      async (_label, budgetOf) => {
        const budgetRepository = {
          resolveSnapshot: jest.fn().mockResolvedValue(
            budgetOf().exists
              ? {
                  id: 'budget-1',
                  workspaceId: 'ws-1',
                  effectiveFrom: new Date('2026-11-01T03:00:00.000Z'),
                  monthlyIncome: 1_500,
                  mode: 'percentage',
                  allocations: [],
                }
              : null,
          ),
          findCompletedExpenseByCategory: jest.fn().mockResolvedValue({}),
          findCategoryParentMap: jest.fn().mockResolvedValue({}),
        } as unknown as BudgetRepository;
        const dateProvider = new DayJsDateProvider();
        jest.spyOn(dateProvider, 'now').mockReturnValue(NOW);
        const workspaceTimezone = {
          execute: jest.fn().mockResolvedValue(TIMEZONE),
        } as unknown as GetWorkspaceTimezoneService;
        const wired = new GetAvailableToSpendService(
          new GetBudgetStatusService(
            budgetRepository,
            findMonthSummary,
            workspaceTimezone,
            dateProvider,
            new InMemoryCacheProvider(),
          ),
          resolveMonthPlan,
          findMonthSummary,
          goalRepository,
          new CardBillDueInsightService(listAccounts, getInvoice),
          new ProjectionShortfallInsightService(getProjection),
          makeBudgetSuggestionInsight(),
          workspaceTimezone,
          dateProvider,
          new InMemoryCacheProvider(),
        );

        await wired.execute(REQUEST);

        expect(findMonthSummary.execute).toHaveBeenCalledTimes(1);
      },
    );

    it('returns the error when the budget status fails', async () => {
      const failure = new Error('budget down');
      getBudgetStatus.execute.mockResolvedValue(left(failure));

      const result = await service.execute(REQUEST);

      expect(result.value).toBe(failure);
    });

    it('returns the error when the month summary fails without a budget', async () => {
      givenBudget({ exists: false });
      const failure = new Error('summary down');
      findMonthSummary.execute.mockResolvedValue(left(failure as never));

      const result = await service.execute(REQUEST);

      expect(result.value).toBe(failure);
    });

    it('is identical when a card gains six pending future parcels', async () => {
      givenAccounts(dueIn(3));
      givenInvoice();
      givenHorizon(makeHorizonMonth());
      const baseline = JSON.stringify(await run());

      givenInvoice(
        makeInvoice({
          transactions: Array.from({ length: 6 }, (_, index) => ({
            id: `parcel-${index}`,
            status: 'PENDING',
          })),
          pendingAmount: 60_000n,
        }),
      );
      givenHorizon(
        makeHorizonMonth({
          pendingInstallments: Array.from({ length: 6 }, () => ({})) as never,
        }),
      );
      getInvoice.execute.mockClear();
      const withParcels = JSON.stringify(await run());

      expect(getInvoice.execute).toHaveBeenCalledTimes(1);
      expect(withParcels).toBe(baseline);
    });
  });

  describe('provisional plan', () => {
    it('derives the figure from the provisional plan and exposes its basis', async () => {
      const basis = makeBasis();
      givenBudget({ exists: false });
      givenPlan({
        source: 'provisional',
        planTotalCents: 10_000,
        basis,
        spentCents: 4_000,
      });
      givenSummary(makeSummary(200));
      goalRepository.sumMonthlyAporteCents.mockResolvedValue(300);

      const response = await run();

      expect(response).toMatchObject({
        budget: {
          exists: true,
          source: 'provisional',
          provisional: true,
          totalTargetCents: 10_000,
          totalSpentCents: 4_000,
          basis,
        },
        remainingBudgetCents: 6_000,
        spendableCents: 5_500,
        perDayCents: 1_833,
        state: 'within-budget',
      });
    });

    it('is over budget when spending passes a frozen provisional plan', async () => {
      givenBudget({ exists: false });
      givenPlan({
        source: 'provisional',
        planTotalCents: 10_000,
        basis: makeBasis({ frozen: true }),
        spentCents: 12_000,
      });
      givenSummary(makeSummary());

      const response = await run();

      expect(response).toMatchObject({
        spendableCents: -2_000,
        perDayCents: null,
        state: 'over-budget',
        insight: { code: 'OVER_BUDGET' },
      });
    });

    it('keeps no-budget with the recurring due and spent when nothing was observed', async () => {
      givenBudget({ exists: false });
      givenPlan({
        source: 'nothing-observed',
        recurringDueCents: 700,
        spentCents: 0,
      });
      givenSummary(makeSummary(700));

      const response = await run();

      expect(response).toMatchObject({
        budget: { exists: false, recurringDueCents: 700, totalSpentCents: 0 },
        spendableCents: null,
        perDayCents: null,
        state: 'no-budget',
      });
    });

    it('does not carry source or basis on a declared plan', async () => {
      const response = await run();

      expect(response.budget).not.toHaveProperty('basis');
    });

    it('asks the plan for the workspace month in its timezone', async () => {
      await run();

      expect(resolveMonthPlan.execute).toHaveBeenCalledWith({
        workspaceId: 'ws-1',
        month: 11,
        year: 2026,
        today: '2026-11-15',
      });
    });

    it('returns the plan error', async () => {
      const failure = new Error('plan down');
      resolveMonthPlan.execute.mockResolvedValue(left(failure));

      const result = await service.execute(REQUEST);

      expect(result.value).toBe(failure);
    });

    it('keeps the no-budget figure when the plan is none', async () => {
      givenBudget({ exists: false });
      givenPlan({ source: 'none' });
      givenSummary(makeSummary(200));

      const response = await run();

      expect(response).toMatchObject({
        budget: { exists: false, recurringDueCents: 200, totalSpentCents: 0 },
        state: 'no-budget',
      });
    });

    it('still returns a figure when the clock crosses local midnight on the last day of the month', async () => {
      const dateProvider = new DayJsDateProvider();
      jest
        .spyOn(dateProvider, 'now')
        .mockReturnValueOnce(new Date('2026-12-01T02:59:59.000Z'))
        .mockReturnValue(new Date('2026-12-01T03:00:00.000Z'));
      const workspaceTimezone = {
        execute: jest.fn().mockResolvedValue(TIMEZONE),
      } as unknown as GetWorkspaceTimezoneService;
      const budgetRepository = {
        resolveSnapshot: jest.fn().mockResolvedValue(null),
        findCompletedExpenseByLocalDay: jest
          .fn()
          .mockResolvedValue([{ day: 30, totalCents: 5_000 }]),
      } as unknown as BudgetRepository;
      const monthProjectionRepository = {
        findMonthLedger: jest.fn().mockResolvedValue([
          {
            key: '2026-11',
            plainExpenses: [{ day: 30, amount: 5_000, pending: false }],
          },
        ]),
        findActiveRecurringRules: jest.fn().mockResolvedValue([]),
      } as unknown as MonthProjectionRepository;
      givenBudget({ exists: false });
      const crossing = new GetAvailableToSpendService(
        getBudgetStatus,
        new ResolveMonthPlanService(
          budgetRepository,
          monthProjectionRepository,
          workspaceTimezone,
          dateProvider,
        ),
        findMonthSummary,
        goalRepository,
        new CardBillDueInsightService(listAccounts, getInvoice),
        new ProjectionShortfallInsightService(getProjection),
        makeBudgetSuggestionInsight(),
        workspaceTimezone,
        dateProvider,
        new InMemoryCacheProvider(),
      );

      const result = await crossing.execute(REQUEST);

      expect(result.value).toMatchObject({
        month: '2026-11',
        budget: { exists: true, source: 'provisional', totalSpentCents: 5_000 },
      });
    });

    it('is identical when run twice', async () => {
      givenBudget({ exists: false });
      givenPlan({
        source: 'provisional',
        planTotalCents: 10_000,
        basis: makeBasis(),
        spentCents: 4_000,
      });

      const first = await run();
      const second = await run();

      expect(second).toEqual(first);
    });

    it('keys the cache under v3', async () => {
      await service.execute(REQUEST);

      expect([...cache.values.keys()]).toEqual([
        expect.stringMatching(
          /^dashboard:available-to-spend:v3:ws-1:g\d+:c\d+:o\d+:2026-11-15$/,
        ),
      ]);
    });
  });

  describe('insight', () => {
    it('is null for a healthy workspace', async () => {
      const response = await run();

      expect(response.insight).toBeNull();
    });

    it('OVER_BUDGET', async () => {
      givenBudget(
        makeBudget({
          totalTargetCents: 1_000,
          totalSpent: 700,
          allocations: [],
        }),
      );
      givenProjection(313);
      goalRepository.sumMonthlyAporteCents.mockResolvedValue(200);

      const response = await run();

      expect(response.insight).toEqual({
        code: 'OVER_BUDGET',
        severity: 'high',
        args: { amount: 213 },
        href: '/budget',
      });
    });

    it('CARD_BILL_DUE', async () => {
      givenAccounts(dueIn(3));
      givenInvoice();

      const response = await run();

      expect(response.insight).toEqual({
        code: 'CARD_BILL_DUE',
        severity: 'high',
        args: { cardId: 'card-1', cardName: 'Nubank', days: 3 },
        href: '/accounts?card=card-1',
      });
      expect(getInvoice.execute).toHaveBeenCalledWith({
        ...REQUEST,
        accountId: 'card-1',
        month: 11,
        year: 2026,
      });
    });

    it('BUDGET_SUGGESTION_READY when nothing else applies', async () => {
      givenPendingIncomeSuggestion();

      const response = await run();

      expect(response.insight).toEqual({
        code: 'BUDGET_SUGGESTION_READY',
        severity: 'low',
        args: { kind: 'income' },
        href: '/budget',
      });
    });

    it('ranks BUDGET_SUGGESTION_READY below UNALLOCATED_INCOME', async () => {
      givenPendingIncomeSuggestion();
      givenBudget(makeBudget({ unallocatedIncomeCents: 800 }));

      const response = await run();

      expect(response.insight?.code).toBe('UNALLOCATED_INCOME');
    });

    it('PROJECTION_SHORTFALL', async () => {
      givenHorizon(
        makeHorizonMonth({
          key: '2026-11',
          status: 'insufficient',
          shortfallCents: 9_999,
        }),
        makeHorizonMonth({ key: '2026-12' }),
        makeHorizonMonth({ key: '2027-01', shortfallCents: 4_500 }),
      );

      const response = await run();

      expect(response.insight).toEqual({
        code: 'PROJECTION_SHORTFALL',
        severity: 'medium',
        args: { monthKey: '2027-01', amount: 4_500 },
        href: '/projections?month=2027-01',
      });
      expect(getProjection.execute).toHaveBeenCalledWith({
        workspaceId: 'ws-1',
        months: 3,
      });
    });

    it('CATEGORY_BREACH', async () => {
      givenBudget(
        makeBudget({
          allocations: [
            makeAllocation(),
            makeBreach('cat-9', 'Lazer', 300),
            makeBreach('cat-8', 'Mercado', 100),
          ],
        }),
      );

      const response = await run();

      expect(response.insight).toEqual({
        code: 'CATEGORY_BREACH',
        severity: 'medium',
        args: { categoryId: 'cat-9', categoryName: 'Lazer', amount: 300 },
        href: '/budget?category=cat-9',
      });
    });

    it('CATEGORY_BREACH breaks ties with pt-BR collation', async () => {
      givenBudget(
        makeBudget({
          allocations: [
            makeBreach('cat-z', 'Zebra', 200),
            makeBreach('cat-a', 'Água', 200),
          ],
        }),
      );

      const response = await run();

      expect(response.insight?.args).toMatchObject({ categoryId: 'cat-a' });
    });

    it('UNALLOCATED_INCOME', async () => {
      givenBudget(makeBudget({ unallocatedIncomeCents: 2_500 }));

      const response = await run();

      expect(response.insight).toEqual({
        code: 'UNALLOCATED_INCOME',
        severity: 'low',
        args: { amount: 2_500 },
        href: '/budget',
      });
    });

    it('picks the nearest due card', async () => {
      givenAccounts(
        makeCreditCard({ id: 'far', name: 'Aaa', dueDay: 20 }),
        makeCreditCard({ id: 'near', name: 'Zzz', dueDay: 16 }),
      );
      givenInvoice();

      const response = await run();

      expect(response.insight?.args).toEqual({
        cardId: 'near',
        cardName: 'Zzz',
        days: 1,
      });
    });

    it('breaks card ties by account name', async () => {
      givenAccounts(
        makeCreditCard({ id: 'nu', name: 'Nubank', dueDay: 18 }),
        makeCreditCard({ id: 'itau', name: 'Itaú', dueDay: 18 }),
      );
      givenInvoice();

      const response = await run();

      expect(response.insight?.args).toMatchObject({ cardId: 'itau', days: 3 });
    });

    it('silences the insight when the account page is truncated', async () => {
      givenBudget(makeBudget({ unallocatedIncomeCents: 800 }));
      listAccounts.execute.mockResolvedValue(
        right({
          accounts: [{ account: dueIn(3), balanceUpdatedAt: null }],
          total: 201,
        } as never),
      );

      const response = await run();

      expect(response.insight).toBeNull();
      expect(getInvoice.execute).not.toHaveBeenCalled();
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining('AccountScanTruncatedError'),
      );
    });

    it('includes a card due today and one due in six days', async () => {
      givenAccounts(
        makeCreditCard({ id: 'today', name: 'A', dueDay: 15 }),
        makeCreditCard({ id: 'six', name: 'B', dueDay: 21 }),
      );
      givenInvoice();

      await run();

      expect(getInvoice.execute).toHaveBeenCalledTimes(2);
    });

    it('rolls over the month when the due date is in the next month', async () => {
      givenAccounts(makeCreditCard({ id: 'next', name: 'N', dueDay: 1 }));
      givenInvoice();
      const dateProvider = new DayJsDateProvider();
      jest
        .spyOn(dateProvider, 'now')
        .mockReturnValue(new Date('2026-11-27T12:00:00.000Z'));
      const rolling = new GetAvailableToSpendService(
        getBudgetStatus,
        resolveMonthPlan,
        findMonthSummary,
        goalRepository,
        new CardBillDueInsightService(listAccounts, getInvoice),
        new ProjectionShortfallInsightService(getProjection),
        makeBudgetSuggestionInsight(),
        { execute: jest.fn().mockResolvedValue(TIMEZONE) } as never,
        dateProvider,
        new InMemoryCacheProvider(),
      );

      const result = await rolling.execute(REQUEST);

      expect(result.value).toMatchObject({
        insight: { args: { cardId: 'next', days: 4 } },
      });
      expect(getInvoice.execute).toHaveBeenCalledWith(
        expect.objectContaining({ month: 12, year: 2026 }),
      );
    });

    it.each([
      ['paid invoice', makeInvoice({ invoiceStatus: 'paid' })],
      ['zero amount', makeInvoice({ totalAmount: 0n })],
    ])('ignores a card with %s', async (_label, invoice) => {
      givenAccounts(dueIn(3));
      givenInvoice(invoice);

      const response = await run();

      expect(response.insight).toBeNull();
    });

    it('does not read invoices for a card outside the due window', async () => {
      givenAccounts(
        makeCreditCard({ id: 'seven', name: 'A', dueDay: 22 }),
        makeCreditCard({ id: 'yesterday', name: 'B', dueDay: 14 }),
        makeCreditCard({ id: 'later', name: 'C', dueDay: 28 }),
      );

      const response = await run();

      expect(getInvoice.execute).not.toHaveBeenCalled();
      expect(response.insight).toBeNull();
    });

    it('prefers OVER_BUDGET over every other applicable insight', async () => {
      givenBudget(
        makeBudget({
          totalTargetCents: 1_000,
          totalSpent: 1_200,
          unallocatedIncomeCents: 800,
          allocations: [makeBreach('cat-9', 'Lazer', 300)],
        }),
      );
      givenAccounts(dueIn(2));
      givenInvoice();
      givenHorizon(makeHorizonMonth({ shortfallCents: 100 }));

      const response = await run();

      expect(response.insight).toMatchObject({
        code: 'OVER_BUDGET',
        severity: 'high',
      });
    });

    it.each([
      ['CARD_BILL_DUE', true, true, true, true],
      ['PROJECTION_SHORTFALL', false, true, true, true],
      ['CATEGORY_BREACH', false, false, true, true],
      ['UNALLOCATED_INCOME', false, false, false, true],
    ])(
      'ranks %s first when it is the highest applicable',
      async (code, card, projection, breach, unallocated) => {
        givenBudget(
          makeBudget({
            unallocatedIncomeCents: unallocated ? 800 : 0,
            allocations: breach ? [makeBreach('cat-9', 'Lazer', 300)] : [],
          }),
        );
        if (card) {
          givenAccounts(dueIn(2));
          givenInvoice();
        }
        if (projection) {
          givenHorizon(makeHorizonMonth({ shortfallCents: 100 }));
        }

        const response = await run();

        expect(response.insight?.code).toBe(code);
      },
    );

    describe('failing source', () => {
      const failureCases: [string, () => void][] = [
        [
          'a rejected projection read',
          () => getProjection.execute.mockRejectedValue(new TypeError('boom')),
        ],
        [
          'a left projection read',
          () => getProjection.execute.mockResolvedValue(left(new Error('x'))),
        ],
        [
          'a rejected accounts read',
          () => listAccounts.execute.mockRejectedValue(new TypeError('boom')),
        ],
      ];

      it.each(failureCases)(
        'returns 200 data with insight null on %s, ignoring lower priorities',
        async (_label, breakSource) => {
          givenBudget(makeBudget({ unallocatedIncomeCents: 800 }));
          const baseline = await run();
          expect(baseline.insight).toMatchObject({
            code: 'UNALLOCATED_INCOME',
          });

          breakSource();
          const response = await run();

          expect(response).toEqual({ ...baseline, insight: null });
        },
      );

      it('logs the code, workspace and error class', async () => {
        getProjection.execute.mockRejectedValue(new TypeError('boom'));

        await run();

        expect(warn).toHaveBeenCalledWith(
          expect.stringContaining('PROJECTION_SHORTFALL'),
        );
        expect(warn).toHaveBeenCalledWith(expect.stringContaining('ws-1'));
        expect(warn).toHaveBeenCalledWith(expect.stringContaining('TypeError'));
      });

      it('silences the insight when a source exceeds 250ms', async () => {
        jest.useFakeTimers();
        const lateRejection = new Promise<never>((_resolve, reject) => {
          setTimeout(() => reject(new Error('late')), 1_000);
        });
        getProjection.execute.mockReturnValue(lateRejection);
        givenBudget(makeBudget({ unallocatedIncomeCents: 800 }));

        const pending = run();
        await jest.advanceTimersByTimeAsync(250);
        const response = await pending;
        await jest.advanceTimersByTimeAsync(1_000);

        expect(response.insight).toBeNull();
        expect(warn).toHaveBeenCalledWith(
          expect.stringContaining('InsightSourceTimeoutError'),
        );
      });
    });
  });
});
