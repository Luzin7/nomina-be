import { RecurrenceFrequency } from '@constants/enums';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  HorizonBundle,
  HorizonMonthWindow,
  projectHorizon,
} from './ProjectionHorizon';
import { LedgerMonth } from './ProjectionRules';
import { RecurringRuleSnapshot } from './MonthProjection';

const TIMEZONE = 'America/Sao_Paulo';
const AS_OF = new Date('2026-10-15T12:00:00.000Z');

const window = (
  key: string,
  start: string,
  end: string,
  days: number,
): HorizonMonthWindow => ({
  key,
  start: new Date(`${start}T03:00:00.000Z`),
  end: new Date(`${end}T23:59:59.999Z`),
  days,
});

const activeMonth = (key: string, prefix: string): LedgerMonth => ({
  key,
  totalIncome: 0,
  totalExpense: 5000,
  pending: { totalIncome: 0, totalExpense: 0 },
  plainExpenses: [3, 10, 15, 20, 25].map((day) => ({
    day,
    categoryId: `${prefix}-${day}`,
    amount: 1000,
    pending: false,
  })),
});

const currentMonth: LedgerMonth = {
  key: '2026-10',
  totalIncome: 300000,
  totalExpense: 2000,
  pending: { totalIncome: 0, totalExpense: 5000 },
  plainExpenses: [
    { day: 5, categoryId: 'out-1', amount: 1000, pending: false },
    { day: 9, categoryId: 'out-2', amount: 1000, pending: false },
  ],
};

const ledger: LedgerMonth[] = [
  activeMonth('2026-07', 'jul'),
  activeMonth('2026-08', 'ago'),
  activeMonth('2026-09', 'set'),
  currentMonth,
];

const rule = (
  overrides: Partial<RecurringRuleSnapshot> = {},
): RecurringRuleSnapshot => ({
  id: 'rule-1',
  type: 'EXPENSE',
  categoryId: 'rent',
  amount: 5000,
  frequency: RecurrenceFrequency.MONTHLY,
  interval: 1,
  startDate: new Date('2026-09-05T03:00:00.000Z'),
  endDate: null,
  lastGenerated: null,
  materializedDates: [],
  ...overrides,
});

const bundle = (overrides: Partial<HorizonBundle> = {}): HorizonBundle => ({
  months: [
    window('2026-10', '2026-10-01', '2026-10-31', 31),
    window('2026-11', '2026-11-01', '2026-11-30', 30),
    window('2026-12', '2026-12-01', '2026-12-31', 31),
    window('2027-01', '2027-01-01', '2027-01-31', 31),
  ],
  asOf: AS_OF,
  timezone: TIMEZONE,
  openingBalanceCents: 100000,
  ledger,
  recurringRules: [],
  pendingInstallments: [],
  budgetSnapshots: [],
  ...overrides,
});

const withExtraExpenseOnMonthThree = (): HorizonBundle => ({
  ...bundle(),
  ledger: [
    ...ledger,
    {
      key: '2026-12',
      totalIncome: 0,
      totalExpense: 0,
      pending: { totalIncome: 0, totalExpense: 1500 },
      plainExpenses: [],
    },
  ],
});

describe('projectHorizon', () => {
  it('returns one ordered month per horizon window', () => {
    const result = projectHorizon(bundle());

    expect(result.months.map((month) => month.key)).toEqual([
      '2026-10',
      '2026-11',
      '2026-12',
      '2027-01',
    ]);
  });

  it('accumulates end balance and derives net and shortfall per month', () => {
    const result = projectHorizon(bundle());

    expect(result.openingBalanceCents).toBe(100000);
    expect(
      result.months.map((month) => ({
        net: month.netCents,
        shortfall: month.shortfallCents,
        end: month.endBalanceCents,
      })),
    ).toEqual([
      { net: 291000, shortfall: 0, end: 93000 },
      { net: -5000, shortfall: 5000, end: 88000 },
      { net: -5000, shortfall: 5000, end: 83000 },
      { net: -5000, shortfall: 5000, end: 78000 },
    ]);
  });

  it('anchors on request-time cash and counts only the post-anchor expectation in the current month', () => {
    const result = projectHorizon(bundle({ openingBalanceCents: 400000 }));
    const first = result.months[0];

    expect(first.sources.realized.totalIncome).toBe(300000);
    expect(first.netCents).toBe(291000);
    expect(first.endBalanceCents).toBe(393000);
    expect(first.endBalanceCents).not.toBe(
      result.openingBalanceCents + first.netCents,
    );
  });

  it('keeps months before an injected expense byte-identical', () => {
    const before = JSON.stringify(projectHorizon(bundle()).months);
    const after = JSON.stringify(
      projectHorizon(withExtraExpenseOnMonthThree()).months,
    );

    expect(JSON.parse(after).slice(0, 2)).toEqual(
      JSON.parse(before).slice(0, 2),
    );
    expect(after.slice(0, before.indexOf('"2026-12"'))).toBe(
      before.slice(0, before.indexOf('"2026-12"')),
    );
  });

  it('changes the month that received the expense and every later one', () => {
    const before = projectHorizon(bundle());
    const after = projectHorizon(withExtraExpenseOnMonthThree());

    expect(after.months[2].sources.scheduled.totalExpense).toBe(1500);
    expect(after.months[2].endBalanceCents).toBeLessThan(
      before.months[2].endBalanceCents,
    );
    expect(after.months[3].endBalanceCents).toBeLessThan(
      before.months[3].endBalanceCents,
    );
  });

  it('marks future months insufficient when nothing is known about them', () => {
    const result = projectHorizon(
      bundle({ ledger: [], recurringRules: [], budgetSnapshots: [] }),
    );

    expect(result.months[0].status).toBe('ok');
    expect(result.months.slice(1).map((month) => month.status)).toEqual([
      'insufficient',
      'insufficient',
      'insufficient',
    ]);
    expect(result.months.slice(1).every((m) => m.shortfallCents === 0)).toBe(
      true,
    );
  });

  it('counts a not-yet-generated recurrence in every month without double counting materialized dates', () => {
    const result = projectHorizon(
      bundle({
        ledger: [currentMonth],
        recurringRules: [
          rule({
            materializedDates: [new Date('2026-09-05T03:00:00.000Z')],
          }),
        ],
      }),
    );

    expect(
      result.months.map((m) => m.sources.recurringNotYetGenerated.totalExpense),
    ).toEqual([5000, 5000, 5000, 5000]);
    expect(result.months[0].sources.realized.totalExpense).toBe(2000);
  });

  it('shows a future pending installment in scheduled and outflow, never in realized', () => {
    const result = projectHorizon(
      bundle({
        ledger: [
          ...ledger,
          {
            key: '2026-11',
            totalIncome: 0,
            totalExpense: 0,
            pending: { totalIncome: 0, totalExpense: 7000 },
            plainExpenses: [],
          },
        ],
        pendingInstallments: [
          {
            date: new Date('2026-11-10T03:00:00.000Z'),
            amount: 7000,
            type: 'EXPENSE',
            recurringId: null,
            installmentNumber: 3,
            installmentCount: 12,
          },
        ],
      }),
    );

    expect(result.months[1].sources.scheduled.totalExpense).toBe(7000);
    expect(result.months[1].sources.realized.totalExpense).toBe(0);
    expect(result.months[1].outflowCents).toBeGreaterThanOrEqual(7000);
  });

  it('reports the resolved budget plan without feeding it into cash flow', () => {
    const withPlan = projectHorizon(
      bundle({
        budgetSnapshots: [
          {
            monthKey: '2026-11',
            snapshot: {
              monthlyIncomeCents: 400000,
              targetCents: 250000,
              mode: 'fixed',
            },
          },
        ],
      }),
    );
    const withoutPlan = projectHorizon(bundle());

    expect(withPlan.months[1].plan).toEqual({
      exists: true,
      monthlyIncomeCents: 400000,
      targetCents: 250000,
      mode: 'fixed',
    });
    expect(withPlan.months[1].netCents).toBe(withoutPlan.months[1].netCents);
    expect(withPlan.months[1].endBalanceCents).toBe(
      withoutPlan.months[1].endBalanceCents,
    );
  });

  it('reports a resolved plan without income as null income', () => {
    const result = projectHorizon(
      bundle({
        budgetSnapshots: [
          {
            monthKey: '2026-11',
            snapshot: {
              monthlyIncomeCents: null,
              targetCents: 250000,
              mode: 'fixed',
            },
          },
        ],
      }),
    );

    expect(result.months[1].plan).toEqual({
      exists: true,
      monthlyIncomeCents: null,
      targetCents: 250000,
      mode: 'fixed',
    });
  });

  it('groups pending installments into their local month and keeps them equal to the scheduled totals', () => {
    const result = projectHorizon(
      bundle({
        ledger: [
          ...ledger,
          {
            key: '2026-11',
            totalIncome: 0,
            totalExpense: 0,
            pending: { totalIncome: 0, totalExpense: 7000 },
            plainExpenses: [],
          },
          {
            key: '2026-12',
            totalIncome: 0,
            totalExpense: 0,
            pending: { totalIncome: 3000, totalExpense: 0 },
            plainExpenses: [],
          },
        ],
        pendingInstallments: [
          {
            date: new Date('2026-10-25T03:00:00.000Z'),
            amount: 5000,
            type: 'EXPENSE',
            recurringId: null,
            installmentNumber: null,
            installmentCount: null,
          },
          {
            date: new Date('2026-11-10T03:00:00.000Z'),
            amount: 4000,
            type: 'EXPENSE',
            recurringId: 'card-1',
            installmentNumber: 3,
            installmentCount: 12,
          },
          {
            date: new Date('2026-11-20T03:00:00.000Z'),
            amount: 3000,
            type: 'EXPENSE',
            recurringId: 'card-1',
            installmentNumber: 4,
            installmentCount: 12,
          },
          {
            date: new Date('2026-12-05T03:00:00.000Z'),
            amount: 3000,
            type: 'INCOME',
            recurringId: null,
            installmentNumber: null,
            installmentCount: null,
          },
        ],
      }),
    );

    expect(result.months[1].pendingInstallments).toEqual([
      {
        date: '2026-11-10',
        amountCents: 4000,
        type: 'EXPENSE',
        recurringId: 'card-1',
        installmentNumber: 3,
        installmentCount: 12,
      },
      {
        date: '2026-11-20',
        amountCents: 3000,
        type: 'EXPENSE',
        recurringId: 'card-1',
        installmentNumber: 4,
        installmentCount: 12,
      },
    ]);
    expect(result.months[2].pendingInstallments.map((row) => row.date)).toEqual(
      ['2026-12-05'],
    );

    for (const month of result.months) {
      const rowsSum = month.pendingInstallments.reduce(
        (total, row) => total + row.amountCents,
        0,
      );

      expect(rowsSum).toBe(
        month.sources.scheduled.totalIncome +
          month.sources.scheduled.totalExpense,
      );
    }
  });

  it('keeps a 23:30 last-day-of-month instant in the workspace local month', () => {
    const result = projectHorizon({
      ...bundle(),
      asOf: new Date('2026-11-01T02:30:00.000Z'),
      months: [
        {
          key: '2026-10',
          start: new Date('2026-10-01T03:00:00.000Z'),
          end: new Date('2026-11-01T02:59:59.999Z'),
          days: 31,
        },
        {
          key: '2026-11',
          start: new Date('2026-11-01T03:00:00.000Z'),
          end: new Date('2026-12-01T02:59:59.999Z'),
          days: 30,
        },
      ],
    });

    expect(result.months.map((month) => month.key)).toEqual([
      '2026-10',
      '2026-11',
    ]);
    expect(result.months[0].sources.variableRemainingCents).toBe(0);
    expect(result.months[1].sources.variableRemainingCents).toBe(5000);
  });

  it('keeps month keys stable across a DST transition in America/New_York', () => {
    const result = projectHorizon({
      ...bundle(),
      asOf: new Date('2026-04-01T03:30:00.000Z'),
      timezone: 'America/New_York',
      months: [
        {
          key: '2026-03',
          start: new Date('2026-03-01T05:00:00.000Z'),
          end: new Date('2026-04-01T03:59:59.999Z'),
          days: 31,
        },
        {
          key: '2026-04',
          start: new Date('2026-04-01T04:00:00.000Z'),
          end: new Date('2026-05-01T03:59:59.999Z'),
          days: 30,
        },
      ],
      ledger: [
        activeMonth('2025-12', 'dez'),
        activeMonth('2026-01', 'jan'),
        activeMonth('2026-02', 'fev'),
        activeMonth('2026-03', 'mar'),
      ],
    });

    expect(result.months.map((month) => month.key)).toEqual([
      '2026-03',
      '2026-04',
    ]);
    expect(result.months[0].sources.variableRemainingCents).toBe(0);
    expect(result.months[1].sources.variableRemainingCents).toBe(5000);
    expect(result.months[1].endBalanceCents).toBe(95000);
  });
});

describe('projectHorizon purity', () => {
  const source = readFileSync(join(__dirname, 'ProjectionHorizon.ts'), 'utf8');
  const importLines = source
    .split('\n')
    .filter((line) => line.startsWith('import '));

  it('imports no repository, Nest provider or cache', () => {
    expect(
      importLines.filter((line) =>
        /@infra|repositories|CacheProvider|DateProvider|GetWorkspaceTimezone/.test(
          line,
        ),
      ),
    ).toEqual([]);
  });

  it('reads no clock', () => {
    expect(source.includes('new Date()')).toBe(false);
    expect(source.includes('Date.now')).toBe(false);
  });
});
