import { AccountType, RecurrenceFrequency } from '@constants/enums';
import { CacheProvider } from '@infra/cache/contracts/CacheProvider';
import { AccountRepository } from '@modules/account/repositories/contracts/AccountRepository';
import { GetBudgetStatusService } from '@modules/budget/features/get-status/get-status.handler';
import { BudgetPresenter } from '@modules/budget/presenters/Budget.presenter';
import { BudgetSnapshot } from '@modules/budget/repositories/contracts/BudgetRepository';
import { FindMonthSummaryService } from '@modules/report/features/get-month-summary/get-month-summary.service';
import { MonthProjectionRepository } from '@modules/report/repositories/contracts/MonthProjectionRepository';
import { ReportRepository } from '@modules/report/repositories/contracts/ReportRepository';
import { MonthSummaryPresenter } from '@modules/report/presenters/MonthlySummary.presenter';
import { projectMonthEnd } from '@modules/report/valueObjects/MonthProjection';
import { LedgerMonth } from '@modules/report/valueObjects/ProjectionRules';
import { GetWorkspaceTimezoneService } from '@modules/workspace/services/get-workspace-timezone.service';
import { RECURRING_GENERATION_TIMEZONE } from '@constants/timezone';
import { DayJsDateProvider } from '@providers/date/implementations/Dayjs';
import { right } from '@shared/core/errors/Either';
import { nextOccurrence } from '@utils/installmentSchedule';
import {
  buildDailySummary,
  buildNetWorthEvolution,
  resolveGeneralType,
  resolveInvestmentType,
} from './features/get-balance-evolution/get-balance-evolution.handler';

const TIMEZONE = 'America/Sao_Paulo';
const NOW = new Date('2026-10-15T12:00:00.000Z');
const OCTOBER_START = new Date('2026-10-01T03:00:00.000Z');

const row = (day: number, amount: number, pending = false) => ({
  day,
  categoryId: 'cat-1',
  amount,
  pending,
});

const active = (
  key: string,
  rows: ReturnType<typeof row>[] = [],
): LedgerMonth => ({
  key,
  totalIncome: 0,
  totalExpense: rows
    .filter((entry) => !entry.pending)
    .reduce((total, entry) => total + entry.amount, 0),
  pending: { totalIncome: 0, totalExpense: 0 },
  plainExpenses: rows,
});

const ledger: LedgerMonth[] = [
  active('2026-07', [
    row(3, 1000),
    row(10, 1000),
    row(15, 1000),
    row(20, 1000),
    row(25, 1000),
  ]),
  active('2026-08', [
    row(3, 1200),
    row(10, 1200),
    row(15, 1200),
    row(20, 1200),
    row(25, 1200),
  ]),
  active('2026-09', [
    row(3, 1400),
    row(10, 1400),
    row(15, 1400),
    row(20, 1400),
    row(25, 1400),
  ]),
  {
    ...active('2026-10', [row(5, 500), row(9, 700)]),
    totalIncome: 300000,
    totalExpense: 4700,
    pending: { totalIncome: 0, totalExpense: 2000 },
  },
];

const PROJECT_MONTH_END_GOLDEN = {
  expectedIncome: 600000,
  expectedExpense: 7900,
  expectedBalance: 592100,
  realized: { totalIncome: 300000, totalExpense: 4700 },
  scheduled: { totalIncome: 0, totalExpense: 2000 },
  recurringNotYetGenerated: { totalIncome: 300000, totalExpense: 0 },
  fixedBillsDue: 0,
  accountedExpense: 6700,
  variableRemaining: 1200,
  paceDaily: 52,
  paceRemaining: 417,
  paceBalance: 592883,
  daysRemaining: 8,
  usualExpense: 6000,
  basisMonths: 3,
  hasHistory: true,
};

const MONTH_SUMMARY_GOLDEN = {
  month: new Date('2026-10-01T03:00:00.000Z'),
  totalIncome: 3000,
  totalExpense: 47,
  totalCheckingBalance: 1050,
  totalInvestmentBalance: 2000,
  totalCreditCardBalance: -300,
  currentMonthSaving: 98,
  previousMonthCompareSaving: 20.53061224489796,
  previousMonthToDate: { totalIncome: 1000, totalExpense: 20 },
  projection: {
    expectedIncome: 3000,
    expectedExpense: 91,
    expectedBalance: 2909,
    realized: { totalIncome: 3000, totalExpense: 47 },
    scheduled: { totalIncome: 0, totalExpense: 20 },
    recurringNotYetGenerated: { totalIncome: 0, totalExpense: 0 },
    fixedBillsDue: 0,
    accountedExpense: 67,
    variableRemaining: 24,
    paceDaily: 0.8,
    paceRemaining: 12.8,
    paceBalance: 2920.2,
    daysRemaining: 16,
    usualExpense: 60,
    basisMonths: 3,
    hasHistory: true,
  },
};

const BUDGET_STATUS_GOLDEN = {
  exists: true,
  mode: 'percentage',
  monthlyIncomeCents: 300000,
  effectiveFrom: new Date('2026-10-01T03:00:00.000Z'),
  allocations: [
    {
      categoryId: 'cat-1',
      categoryName: 'Moradia',
      groupName: 'Custos fixos',
      targetCents: 180000,
      spentCents: 50000,
      remainingCents: 130000,
      percentageOfIncome: 60,
      percentageUsed: 28,
    },
    {
      categoryId: 'cat-2',
      categoryName: 'Lazer',
      groupName: 'Conforto',
      targetCents: 120000,
      spentCents: 30000,
      remainingCents: 90000,
      percentageOfIncome: 40,
      percentageUsed: 25,
    },
  ],
  pillars: [
    {
      groupName: 'Custos fixos',
      targetCents: 180000,
      spentCents: 50000,
      percentage: 60,
    },
    {
      groupName: 'Conforto',
      targetCents: 120000,
      spentCents: 30000,
      percentage: 40,
    },
  ],
  unallocatedSpent: 0,
  totalTargetCents: 300000,
  unallocatedIncomeCents: 0,
  allocationState: 'balanced',
  totalSpent: 80000,
  projection: { ...MONTH_SUMMARY_GOLDEN.projection },
};

const BALANCE_EVOLUTION_GOLDEN = {
  evolution: [
    { date: '2026-10-01', income: 3000, expense: 0, balance: 4000 },
    { date: '2026-10-02', income: 0, expense: 40, balance: 3960 },
  ],
  investments: [
    { date: '2026-10-01', income: 0, expense: 0, balance: 2000 },
    { date: '2026-10-02', income: 0, expense: 0, balance: 2000 },
  ],
  netWorth: [
    { date: '2026-10-01', income: 3000, expense: 0, balance: 3040 },
    { date: '2026-10-02', income: 0, expense: 40, balance: 3000 },
  ],
  totalInvested: 2000,
};

const MONTH_SUMMARY_PROJECTION_CENTS = {
  expectedIncome: 300000,
  expectedExpense: 9100,
  expectedBalance: 290900,
  realized: { totalIncome: 300000, totalExpense: 4700 },
  scheduled: { totalIncome: 0, totalExpense: 2000 },
  recurringNotYetGenerated: { totalIncome: 0, totalExpense: 0 },
  fixedBillsDue: 0,
  accountedExpense: 6700,
  variableRemaining: 2400,
  paceDaily: 80,
  paceRemaining: 1280,
  paceBalance: 292020,
  daysRemaining: 16,
  usualExpense: 6000,
  basisMonths: 3,
  hasHistory: true,
};

const makeBudgetSnapshot = (): BudgetSnapshot => ({
  id: 'budget-1',
  workspaceId: 'ws-1',
  effectiveFrom: OCTOBER_START,
  monthlyIncome: 300000,
  mode: 'percentage',
  allocations: [
    {
      id: 'allocation-1',
      categoryId: 'cat-1',
      categoryName: 'Moradia',
      groupName: 'Custos fixos',
      groupOrder: 0,
      categoryOrder: 0,
      percentageOfIncome: 60,
      targetCents: 180000,
    },
    {
      id: 'allocation-2',
      categoryId: 'cat-2',
      categoryName: 'Lazer',
      groupName: 'Conforto',
      groupOrder: 1,
      categoryOrder: 0,
      percentageOfIncome: 40,
      targetCents: 120000,
    },
  ],
});

const makeMonthSummary = () => {
  const service = new FindMonthSummaryService(
    {
      findMonthSummaryMetrics: jest.fn().mockResolvedValue({
        currentMonthData: { totalIncome: 300000, totalExpense: 4700 },
        previousMonthData: { totalIncome: 250000, totalExpense: 5000 },
        previousMonthToDateData: { totalIncome: 100000, totalExpense: 2000 },
      }),
    } as unknown as jest.Mocked<ReportRepository>,
    {
      findAllByWorkspaceId: jest.fn().mockResolvedValue([
        { type: AccountType.CHECKING, balance: 100000 },
        { type: AccountType.CASH, balance: 5000 },
        { type: AccountType.INVESTMENT, balance: 200000 },
        { type: AccountType.CREDIT_CARD, balance: -30000 },
      ]),
    } as unknown as jest.Mocked<AccountRepository>,
    {
      findMonthLedger: jest.fn().mockResolvedValue(ledger),
      findActiveRecurringRules: jest.fn().mockResolvedValue([]),
    } as unknown as jest.Mocked<MonthProjectionRepository>,
    {
      execute: jest.fn().mockResolvedValue(TIMEZONE),
    } as unknown as jest.Mocked<GetWorkspaceTimezoneService>,
    Object.assign(new DayJsDateProvider(), { now: () => NOW }),
    {
      get: jest.fn().mockResolvedValue(null),
      set: jest.fn().mockResolvedValue(true),
      readCounter: jest.fn().mockResolvedValue(1),
    } as unknown as jest.Mocked<CacheProvider>,
  );

  return service;
};

describe('report regression goldens', () => {
  afterEach(() => jest.restoreAllMocks());

  it('keeps the current-month projection unchanged', () => {
    const projection = projectMonthEnd({
      month: {
        key: '2026-10',
        start: OCTOBER_START,
        end: new Date('2026-11-01T02:59:59.999Z'),
        days: 31,
      },
      dayOfMonth: 23,
      realized: { totalIncome: 300000, totalExpense: 4700 },
      ledger,
      recurringRules: [
        {
          id: 'rule-income',
          type: 'INCOME',
          categoryId: 'cat-income',
          amount: 300000,
          frequency: RecurrenceFrequency.MONTHLY,
          interval: 1,
          startDate: new Date('2026-01-05T12:00:00.000Z'),
          endDate: null,
          lastGenerated: new Date('2026-09-05T12:00:00.000Z'),
          materializedDates: [new Date('2026-09-05T12:00:00.000Z')],
        },
      ],
      nextOccurrence: (date, rule) =>
        nextOccurrence(
          {
            startDate: date,
            frequency: rule.frequency,
            interval: rule.interval,
            timezone: RECURRING_GENERATION_TIMEZONE,
          },
          new DayJsDateProvider(),
        ),
    });

    expect(projection).toEqual(PROJECT_MONTH_END_GOLDEN);
  });

  it('keeps the month-summary response unchanged', async () => {
    const result = await makeMonthSummary().execute({
      sub: 'user-1',
      workspaceId: 'ws-1',
    });

    if (!result.isRight()) throw new Error('expected right');

    expect(MonthSummaryPresenter.toHTTP(result.value)).toEqual(
      MONTH_SUMMARY_GOLDEN,
    );
  });

  it('keeps the budget-status response unchanged', async () => {
    const service = new GetBudgetStatusService(
      {
        resolveSnapshot: jest.fn().mockResolvedValue(makeBudgetSnapshot()),
        findCompletedExpenseByCategory: jest.fn().mockResolvedValue({
          'cat-1': 50000,
          'cat-2': 30000,
        }),
        findCategoryParentMap: jest.fn().mockResolvedValue({}),
      } as never,
      {
        execute: jest.fn().mockResolvedValue(
          right({
            month: OCTOBER_START,
            totalIncome: 300000,
            totalExpense: 4700,
            totalCheckingBalance: 105000,
            totalInvestmentBalance: 200000,
            totalCreditCardBalance: -30000,
            rate: { currentMonthSaving: 98, previousMonthCompareSaving: 10 },
            previousMonthToDate: { totalIncome: 100000, totalExpense: 2000 },
            projection: MONTH_SUMMARY_PROJECTION_CENTS,
          }),
        ),
      } as never,
      {
        execute: jest.fn().mockResolvedValue(TIMEZONE),
      } as unknown as jest.Mocked<GetWorkspaceTimezoneService>,
      Object.assign(new DayJsDateProvider(), { now: () => NOW }),
    );

    const result = await service.execute({
      workspaceId: 'ws-1',
      sub: 'user-1',
      month: 10,
      year: 2026,
    });

    if (!result.isRight()) throw new Error('expected right');

    expect(BudgetPresenter.toStatus(result.value)).toEqual(
      BUDGET_STATUS_GOLDEN,
    );
  });

  it('keeps the balance-evolution response unchanged', () => {
    const dateProvider = new DayJsDateProvider();
    const startDate = new Date('2026-10-01T03:00:00.000Z');
    const endDate = new Date('2026-10-03T02:59:59.999Z');
    const period = [
      {
        type: 'INCOME',
        sourceType: 'CHECKING',
        destType: null,
        amount: 300000,
        date: new Date('2026-10-01T15:00:00.000Z'),
      },
      {
        type: 'EXPENSE',
        sourceType: 'CHECKING',
        destType: null,
        amount: 4000,
        date: new Date('2026-10-02T15:00:00.000Z'),
      },
    ];

    const response = {
      evolution: buildDailySummary({
        opening: [],
        period,
        resolve: resolveGeneralType,
        dateProvider,
        timezone: TIMEZONE,
        startDate,
        endDate,
        explicitStartBalance: 100000,
      }),
      investments: buildDailySummary({
        opening: [],
        period: [],
        resolve: resolveInvestmentType,
        dateProvider,
        timezone: TIMEZONE,
        startDate,
        endDate,
        explicitStartBalance: 200000,
      }),
      netWorth: buildNetWorthEvolution({
        period,
        currentNetWorth: 300000,
        dateProvider,
        timezone: TIMEZONE,
        startDate,
        endDate,
      }),
      totalInvested: 2000,
    };

    expect(response).toEqual(BALANCE_EVOLUTION_GOLDEN);
  });
});
