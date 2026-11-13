import { InMemoryCacheProvider } from '@shared/cache/test-helpers/in-memory-cache';
import { RecurrenceFrequency } from '@constants/enums';
import { MonthProjectionRepository } from '@modules/report/repositories/contracts/MonthProjectionRepository';
import {
  projectMonth,
  type HorizonMonthWindow,
} from '@modules/report/valueObjects/ProjectionHorizon';
import type { LedgerMonth } from '@modules/report/valueObjects/ProjectionRules';
import type { RecurringRuleSnapshot } from '@modules/report/valueObjects/MonthProjection';
import {
  RecurringSummaryRule,
  RecurringTransactionRepository,
} from '@modules/transaction/repositories/contracts/RecurringTransactionRepository';
import { GetWorkspaceTimezoneService } from '@modules/workspace/services/get-workspace-timezone.service';
import { DayJsDateProvider } from '@providers/date/implementations/Dayjs';
import { RecurringSummaryService } from './recurring-summary.service';

const NOW = new Date('2026-09-15T12:00:00.000Z');
const TIMEZONE = 'America/Sao_Paulo';
const CURRENT_MONTH: HorizonMonthWindow = {
  key: '2026-09',
  start: new Date('2026-09-01T03:00:00.000Z'),
  end: new Date('2026-10-01T02:59:59.999Z'),
  days: 30,
};

const localMidnight = (isoDate: string): Date =>
  new Date(`${isoDate}T03:00:00.000Z`);

const makeRule = (
  overrides: Partial<RecurringSummaryRule> = {},
): RecurringSummaryRule => ({
  id: 'rule-1',
  title: 'Aluguel',
  type: 'EXPENSE',
  amount: 10000,
  frequency: RecurrenceFrequency.MONTHLY,
  interval: 1,
  installmentCount: null,
  startDate: localMidnight('2027-01-05'),
  endDate: null,
  active: true,
  exhausted: false,
  ...overrides,
});

const makeLedgerMonth = (
  overrides: Partial<LedgerMonth> = {},
): LedgerMonth => ({
  key: CURRENT_MONTH.key,
  totalIncome: 0,
  totalExpense: 0,
  pending: { totalIncome: 0, totalExpense: 0 },
  plainExpenses: [],
  ...overrides,
});

const makeSnapshot = (
  overrides: Partial<RecurringRuleSnapshot> = {},
): RecurringRuleSnapshot => ({
  id: 'snapshot-1',
  type: 'EXPENSE',
  categoryId: 'cat-1',
  amount: 30000,
  frequency: RecurrenceFrequency.MONTHLY,
  interval: 1,
  startDate: CURRENT_MONTH.start,
  endDate: null,
  lastGenerated: null,
  materializedDates: [],
  ...overrides,
});

type Fixture = {
  rules?: RecurringSummaryRule[];
  ledger?: LedgerMonth[];
  recurringRules?: RecurringRuleSnapshot[];
  materializedThisMonthCents?: number;
};

const buildService = ({
  rules = [],
  ledger = [makeLedgerMonth()],
  recurringRules = [],
  materializedThisMonthCents = 0,
}: Fixture = {}) => {
  const recurringRepository = {
    findSummaryRules: jest.fn().mockResolvedValue(rules),
    findCompletedRecurringExpense: jest
      .fn()
      .mockResolvedValue(materializedThisMonthCents),
  } as unknown as jest.Mocked<RecurringTransactionRepository>;
  const projectionRepository = {
    findMonthLedger: jest.fn().mockResolvedValue(ledger),
    findActiveRecurringRules: jest.fn().mockResolvedValue(recurringRules),
  } as unknown as jest.Mocked<MonthProjectionRepository>;
  const workspaceTimezone = {
    execute: jest.fn().mockResolvedValue(TIMEZONE),
  } as unknown as jest.Mocked<GetWorkspaceTimezoneService>;
  const dateProvider = new DayJsDateProvider();
  jest.spyOn(dateProvider, 'now').mockReturnValue(NOW);

  return {
    service: new RecurringSummaryService(
      recurringRepository,
      projectionRepository,
      workspaceTimezone,
      dateProvider,
      new InMemoryCacheProvider(),
    ),
    recurringRepository,
    projectionRepository,
  };
};

const run = async (fixture: Fixture = {}) => {
  const result = await buildService(fixture).service.execute({
    workspaceId: 'ws-1',
  });

  if (result.isLeft()) throw result.value;

  return result.value;
};

const frequencyFixture = (): RecurringSummaryRule[] => [
  makeRule({
    id: 'weekly-1',
    frequency: RecurrenceFrequency.WEEKLY,
    interval: 1,
    amount: 10000,
  }),
  makeRule({
    id: 'weekly-2',
    frequency: RecurrenceFrequency.WEEKLY,
    interval: 2,
    amount: 10000,
  }),
  makeRule({
    id: 'monthly-1',
    frequency: RecurrenceFrequency.MONTHLY,
    interval: 1,
    amount: 10000,
  }),
  makeRule({
    id: 'monthly-3',
    frequency: RecurrenceFrequency.MONTHLY,
    interval: 3,
    amount: 10000,
  }),
  makeRule({
    id: 'yearly-1',
    frequency: RecurrenceFrequency.YEARLY,
    interval: 1,
    amount: 120000,
  }),
];

describe('RecurringSummaryService', () => {
  it('applies the monthly equivalent per frequency and interval', async () => {
    const summary = await run({ rules: frequencyFixture() });

    expect(summary.byFrequency).toEqual([
      {
        frequency: RecurrenceFrequency.WEEKLY,
        interval: 1,
        count: 1,
        monthlyEquivalentCents: 43334,
      },
      {
        frequency: RecurrenceFrequency.WEEKLY,
        interval: 2,
        count: 1,
        monthlyEquivalentCents: 21667,
      },
      {
        frequency: RecurrenceFrequency.MONTHLY,
        interval: 1,
        count: 1,
        monthlyEquivalentCents: 10000,
      },
      {
        frequency: RecurrenceFrequency.MONTHLY,
        interval: 3,
        count: 1,
        monthlyEquivalentCents: 3334,
      },
      {
        frequency: RecurrenceFrequency.YEARLY,
        interval: 1,
        count: 1,
        monthlyEquivalentCents: 10000,
      },
    ]);
  });

  it('adds the per-frequency parts up to the total', async () => {
    const summary = await run({ rules: frequencyFixture() });

    const parts = summary.byFrequency.reduce(
      (total, row) => total + row.monthlyEquivalentCents,
      0,
    );

    expect(parts).toBe(summary.monthlyEquivalentCents);
  });

  it('totals only the expense side and reports the committed income share', async () => {
    const summary = await run({
      rules: [
        makeRule({
          id: 'salary',
          title: 'Salário',
          type: 'INCOME',
          amount: 500000,
        }),
        makeRule({ id: 'rent', amount: 200000 }),
        makeRule({ id: 'netflix', amount: 5000 }),
        makeRule({ id: 'phone', amount: 80000, installmentCount: 12 }),
        makeRule({ id: 'paused', amount: 90000, active: false }),
        makeRule({
          id: 'old-plan',
          amount: 70000,
          installmentCount: 6,
          exhausted: true,
        }),
      ],
    });

    expect(summary.monthlyEquivalentCents).toBe(285000);
    expect(summary.recurringExpenseMonthlyCents).toBe(205000);
    expect(summary.installmentMonthlyCents).toBe(80000);
    expect(summary.recurringIncomeMonthlyCents).toBe(500000);
    expect(summary.committedIncomePercent).toBe(57);
    expect(summary.byFrequency).toEqual([
      {
        frequency: RecurrenceFrequency.MONTHLY,
        interval: 1,
        count: 3,
        monthlyEquivalentCents: 285000,
      },
    ]);
  });

  it('returns a null committed share when there is no recurring income', async () => {
    const summary = await run({ rules: [makeRule({ amount: 10000 })] });

    expect(summary.recurringIncomeMonthlyCents).toBe(0);
    expect(summary.committedIncomePercent).toBeNull();
  });

  it('counts paused and exhausted rules without adding their equivalents', async () => {
    const summary = await run({
      rules: [
        makeRule({ id: 'active', amount: 10000 }),
        makeRule({ id: 'paused', amount: 500000, active: false }),
        makeRule({ id: 'exhausted', amount: 400000, exhausted: true }),
      ],
    });

    expect(summary.monthlyEquivalentCents).toBe(10000);
    expect(summary.activeCount).toBe(1);
    expect(summary.pausedCount).toBe(1);
    expect(summary.exhaustedCount).toBe(1);
    expect(summary.byFrequency).toEqual([
      {
        frequency: RecurrenceFrequency.MONTHLY,
        interval: 1,
        count: 1,
        monthlyEquivalentCents: 10000,
      },
    ]);
  });

  it('lists every active occurrence in the 30-day window ordered by date then name', async () => {
    const summary = await run({
      rules: [
        makeRule({
          id: 'salary',
          title: 'Salário',
          type: 'INCOME',
          amount: 500000,
          startDate: localMidnight('2026-09-05'),
        }),
        makeRule({
          id: 'groceries',
          title: 'Mercado',
          type: 'EXPENSE',
          amount: 5000,
          frequency: RecurrenceFrequency.WEEKLY,
          startDate: localMidnight('2026-09-16'),
        }),
        makeRule({
          id: 'rent',
          title: 'Aluguel',
          type: 'EXPENSE',
          amount: 200000,
          startDate: localMidnight('2026-09-20'),
        }),
      ],
    });

    expect(summary.next30Days).toEqual([
      {
        date: '2026-09-16',
        name: 'Mercado',
        amountCents: 5000,
        type: 'EXPENSE',
      },
      {
        date: '2026-09-20',
        name: 'Aluguel',
        amountCents: 200000,
        type: 'EXPENSE',
      },
      {
        date: '2026-09-23',
        name: 'Mercado',
        amountCents: 5000,
        type: 'EXPENSE',
      },
      {
        date: '2026-09-30',
        name: 'Mercado',
        amountCents: 5000,
        type: 'EXPENSE',
      },
      {
        date: '2026-10-05',
        name: 'Salário',
        amountCents: 500000,
        type: 'INCOME',
      },
      {
        date: '2026-10-07',
        name: 'Mercado',
        amountCents: 5000,
        type: 'EXPENSE',
      },
      {
        date: '2026-10-14',
        name: 'Mercado',
        amountCents: 5000,
        type: 'EXPENSE',
      },
    ]);
  });

  it('includes today and the last day of the window', async () => {
    const summary = await run({
      rules: [makeRule({ startDate: localMidnight('2026-09-15') })],
    });

    expect(summary.next30Days.map((entry) => entry.date)).toEqual([
      '2026-09-15',
      '2026-10-15',
    ]);
  });

  it('reads still-to-come from the current month projection', async () => {
    const ledger = [
      makeLedgerMonth({ totalIncome: 100000, totalExpense: 40000 }),
    ];
    const recurringRules = [makeSnapshot()];

    const summary = await run({ ledger, recurringRules });
    const projection = projectMonth({
      month: CURRENT_MONTH,
      asOf: NOW,
      timezone: TIMEZONE,
      realized: { totalIncome: 100000, totalExpense: 40000 },
      ledger,
      recurringRules,
    });

    expect(summary.stillToComeThisMonthCents).toBe(30000);
    expect(summary.stillToComeThisMonthCents).toBe(
      projection.recurringNotYetGenerated.totalExpense,
    );
  });

  it('keeps materialized recurring expense out of the non-recurring remainder', async () => {
    const ledger = [
      makeLedgerMonth({ totalIncome: 900000, totalExpense: 80000 }),
    ];

    const summary = await run({
      ledger,
      materializedThisMonthCents: 50000,
    });
    const projection = projectMonth({
      month: CURRENT_MONTH,
      asOf: NOW,
      timezone: TIMEZONE,
      realized: { totalIncome: 900000, totalExpense: 80000 },
      ledger,
      recurringRules: [],
    });

    expect(summary.materializedThisMonthCents).toBe(50000);
    expect(
      projection.realized.totalExpense - summary.materializedThisMonthCents,
    ).toBe(30000);
  });
});
