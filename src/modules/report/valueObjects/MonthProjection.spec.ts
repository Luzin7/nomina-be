import { RECURRING_GENERATION_TIMEZONE } from '@constants/timezone';
import { RecurrenceFrequency } from '@constants/enums';
import { DayJsDateProvider } from '@providers/date/implementations/Dayjs';
import { nextOccurrence } from '@utils/installmentSchedule';
import {
  LedgerMonth,
  MonthProjectionInput,
  PlainExpense,
  projectMonthEnd,
  RecurringRuleSnapshot,
} from './MonthProjection';

const dateProvider = new DayJsDateProvider();

const localMidnight = (day: string) => new Date(`${day}T03:00:00.000Z`);

const SEPTEMBER_1 = localMidnight('2026-09-01');
const SEPTEMBER_5 = localMidnight('2026-09-05');

const stepRule = (date: Date, rule: RecurringRuleSnapshot) =>
  nextOccurrence(
    {
      startDate: date,
      frequency: rule.frequency,
      interval: rule.interval,
      timezone: RECURRING_GENERATION_TIMEZONE,
    },
    dateProvider,
  );

const makeRule = (
  overrides: Partial<RecurringRuleSnapshot> = {},
): RecurringRuleSnapshot => ({
  id: 'rule-1',
  type: 'EXPENSE',
  amount: 5000,
  frequency: RecurrenceFrequency.MONTHLY,
  interval: 1,
  startDate: SEPTEMBER_5,
  endDate: null,
  lastGenerated: null,
  materializedDates: [],
  ...overrides,
});

const makeRow = (overrides: Partial<PlainExpense> = {}): PlainExpense => ({
  day: 25,
  categoryId: 'cat-daily',
  amount: 1000,
  pending: false,
  ...overrides,
});

const makeLedgerMonth = (
  key: string,
  overrides: Partial<LedgerMonth> = {},
): LedgerMonth => ({
  key,
  totalExpense: 0,
  pending: { totalIncome: 0, totalExpense: 0 },
  plainExpenses: [],
  ...overrides,
});

const FIVE_ACTIVE_DAYS = [10, 11, 12, 13, 14].map((day) => makeRow({ day }));

const activeMonth = (
  key: string,
  extraRows: PlainExpense[] = [],
  overrides: Partial<LedgerMonth> = {},
): LedgerMonth =>
  makeLedgerMonth(key, {
    plainExpenses: [...FIVE_ACTIVE_DAYS, ...extraRows],
    ...overrides,
  });

const windowRow = (amount: number) => makeRow({ day: 25, amount });
const luzRow = (amount: number) =>
  makeRow({ day: 2, categoryId: 'luz', amount });
const aluguelRow = makeRow({ day: 2, categoryId: 'aluguel', amount: 150000 });

const SEPTEMBER = '2026-09';
const AUGUST = '2026-08';
const JULY = '2026-07';
const JUNE = '2026-06';
const MAY = '2026-05';
const APRIL = '2026-04';
const MARCH = '2026-03';

const windowMonths = (amounts: number[]): LedgerMonth[] =>
  amounts.map((amount, index) =>
    activeMonth([SEPTEMBER, AUGUST, JULY, JUNE, MAY, APRIL, MARCH][index], [
      windowRow(amount),
    ]),
  );

const OCTOBER = {
  key: '2026-10',
  start: localMidnight('2026-10-01'),
  end: new Date('2026-11-01T02:59:59.999Z'),
  days: 31,
};

const makeInput = (
  overrides: Partial<MonthProjectionInput> = {},
): MonthProjectionInput => ({
  month: {
    key: SEPTEMBER,
    start: SEPTEMBER_1,
    end: new Date('2026-10-01T02:59:59.999Z'),
    days: 30,
  },
  dayOfMonth: 10,
  realized: { totalIncome: 0, totalExpense: 0 },
  recurringRules: [],
  nextOccurrence: stepRule,
  ledger: [],
  ...overrides,
});

const makeOctoberInput = (
  overrides: Partial<MonthProjectionInput> = {},
): MonthProjectionInput =>
  makeInput({ month: OCTOBER, dayOfMonth: 23, ...overrides });

const currentMonth = (
  rows: PlainExpense[],
  overrides: Partial<LedgerMonth> = {},
) => makeLedgerMonth('2026-10', { plainExpenses: rows, ...overrides });

const THIRTY_DAY_BASIS = [SEPTEMBER, JUNE, APRIL];

const flatMonth = (key: string): LedgerMonth =>
  makeLedgerMonth(key, {
    plainExpenses: Array.from({ length: 30 }, (_, index) =>
      makeRow({ day: index + 1, amount: 100 }),
    ),
  });

const shapeMonth = (key: string): LedgerMonth =>
  makeLedgerMonth(key, {
    plainExpenses: [
      makeRow({ day: 2, categoryId: 'luz', amount: 20000 }),
      makeRow({ day: 5, amount: 0 }),
      makeRow({ day: 10, amount: 500 }),
      makeRow({ day: 20, amount: 500 }),
      makeRow({ day: 25, amount: 2000 }),
    ],
  });

const frontLoadedMonth = (key: string): LedgerMonth =>
  makeLedgerMonth(key, {
    plainExpenses: [
      ...[1, 2, 3, 4].map((day) => makeRow({ day, amount: 0 })),
      makeRow({ day: 5, amount: 3000 }),
    ],
  });

const billInWindowMonth = (key: string): LedgerMonth =>
  makeLedgerMonth(key, {
    plainExpenses: [
      ...[1, 2, 3].map((day) => makeRow({ day, amount: 0 })),
      makeRow({ day: 20, amount: 500 }),
      makeRow({ day: 25, categoryId: 'luz', amount: 20000 }),
    ],
  });

const shortMonthBasis = (): LedgerMonth[] => [
  makeLedgerMonth('2026-02', {
    plainExpenses: [1, 2, 3, 4, 5].map((day) => makeRow({ day, amount: 0 })),
  }),
  makeLedgerMonth('2026-01', {
    plainExpenses: [
      ...[1, 2, 3, 4].map((day) => makeRow({ day, amount: 0 })),
      makeRow({ day: 31, amount: 1000 }),
    ],
  }),
  makeLedgerMonth('2025-12', {
    plainExpenses: [
      ...[1, 2, 3, 4].map((day) => makeRow({ day, amount: 0 })),
      makeRow({ day: 31, amount: 1000 }),
    ],
  }),
];

const marchInput = (
  overrides: Partial<MonthProjectionInput> = {},
): MonthProjectionInput =>
  makeInput({
    month: {
      key: '2026-03',
      start: localMidnight('2026-03-01'),
      end: new Date('2026-04-01T02:59:59.999Z'),
      days: 31,
    },
    dayOfMonth: 30,
    ledger: [...shortMonthBasis(), makeLedgerMonth('2026-03')],
    ...overrides,
  });

const dailyRows = (days: number, amount: number): PlainExpense[] =>
  Array.from({ length: days }, (_, index) =>
    makeRow({ day: index + 1, amount }),
  );

const pacedBasisMonth = (key: string, windowAmount: number): LedgerMonth =>
  makeLedgerMonth(key, {
    plainExpenses: [
      ...[1, 2, 3, 4, 5].map((day) => makeRow({ day, amount: 0 })),
      makeRow({ day: 2, categoryId: 'luz', amount: 2500 }),
      windowRow(windowAmount),
    ],
  });

const THIRTEEN_DAY_MONTH = {
  key: '2026-10',
  start: localMidnight('2026-10-01'),
  end: new Date('2026-10-14T02:59:59.999Z'),
  days: 13,
};

describe('projectMonthEnd', () => {
  describe('history', () => {
    it('has no history and no estimates with an empty ledger', () => {
      const projection = projectMonthEnd(makeOctoberInput());

      expect(projection.basisMonths).toBe(0);
      expect(projection.hasHistory).toBe(false);
      expect(projection.fixedBillsDue).toBe(0);
      expect(projection.variableRemaining).toBe(0);
      expect(projection.paceDaily).toBeNull();
      expect(projection.usualExpense).toBeNull();
    });

    it('keeps every pace estimate off until three active months of history', () => {
      const projection = projectMonthEnd(
        makeOctoberInput({
          ledger: [
            ...windowMonths([1000, 2000]),
            makeLedgerMonth('2026-01', {
              plainExpenses: [makeRow({ day: 1 }), makeRow({ day: 1 })],
            }),
          ],
        }),
      );

      expect(projection.basisMonths).toBe(2);
      expect(projection.hasHistory).toBe(false);
      expect(projection.paceDaily).toBeNull();
      expect(projection.variableRemaining).toBe(0);
      expect(projection.fixedBillsDue).toBe(0);
      expect(projection.usualExpense).toBeNull();
    });

    it('does not count a month with four active days', () => {
      const projection = projectMonthEnd(
        makeOctoberInput({
          ledger: [
            ...windowMonths([1000, 2000]),
            makeLedgerMonth(JULY, {
              plainExpenses: FIVE_ACTIVE_DAYS.slice(0, 4),
            }),
          ],
        }),
      );

      expect(projection.basisMonths).toBe(2);
    });

    it('ignores an active month older than twelve months', () => {
      const projection = projectMonthEnd(
        makeOctoberInput({
          ledger: [...windowMonths([1000, 2000]), activeMonth('2025-09')],
        }),
      );

      expect(projection.basisMonths).toBe(2);
      expect(projection.hasHistory).toBe(false);
    });
  });

  describe('basis sizing', () => {
    it('uses three active months', () => {
      const projection = projectMonthEnd(
        makeOctoberInput({ ledger: windowMonths([1000, 2000, 3000]) }),
      );

      expect(projection.basisMonths).toBe(3);
      expect(projection.hasHistory).toBe(true);
      expect(projection.fixedBillsDue).toBe(0);
    });

    it('uses four active months', () => {
      const projection = projectMonthEnd(
        makeOctoberInput({ ledger: windowMonths([1000, 2000, 3000, 4000]) }),
      );

      expect(projection.basisMonths).toBe(4);
      expect(projection.variableRemaining).toBe(2500);
    });

    it('uses five active months', () => {
      const projection = projectMonthEnd(
        makeOctoberInput({
          ledger: windowMonths([1000, 2000, 3000, 4000, 5000]),
        }),
      );

      expect(projection.basisMonths).toBe(5);
      expect(projection.variableRemaining).toBe(3000);
    });

    it('uses six active months', () => {
      const projection = projectMonthEnd(
        makeOctoberInput({
          ledger: windowMonths([1000, 2000, 3000, 4000, 5000, 6000]),
        }),
      );

      expect(projection.basisMonths).toBe(6);
      expect(projection.variableRemaining).toBe(3500);
    });

    it('uses only the newest six of seven active months', () => {
      const projection = projectMonthEnd(
        makeOctoberInput({
          ledger: windowMonths([1000, 2000, 3000, 4000, 5000, 6000, 900000]),
        }),
      );

      expect(projection.basisMonths).toBe(6);
      expect(projection.variableRemaining).toBe(3500);
      expect(projection.expectedExpense).toBe(3500);
    });

    it('skips an inactive month and fills from an older one', () => {
      const projection = projectMonthEnd(
        makeOctoberInput({
          ledger: [
            activeMonth(SEPTEMBER, [windowRow(1000)]),
            activeMonth(AUGUST, [windowRow(2000)]),
            makeLedgerMonth(JULY, { plainExpenses: [makeRow({ day: 3 })] }),
            activeMonth(JUNE, [windowRow(3000)]),
            activeMonth(MAY, [windowRow(4000)]),
            activeMonth(APRIL, [windowRow(5000)]),
            activeMonth(MARCH, [windowRow(6000)]),
            activeMonth('2026-02', [windowRow(900000)]),
          ],
        }),
      );

      expect(projection.basisMonths).toBe(6);
      expect(projection.variableRemaining).toBe(3500);
      expect(projection.expectedExpense).toBe(3500);
    });
  });

  describe('fixed bills', () => {
    const billMonths = (
      luzAmounts: number[],
      withAluguel = true,
    ): LedgerMonth[] =>
      luzAmounts.map((amount, index) =>
        activeMonth([SEPTEMBER, AUGUST, JULY][index], [
          windowRow(1000),
          luzRow(amount),
          ...(withAluguel ? [aluguelRow] : []),
        ]),
      );

    it('does not re-project front-loaded bills already paid on day 2', () => {
      const projection = projectMonthEnd(
        makeOctoberInput({
          ledger: [
            ...billMonths([20000, 22000, 24000]),
            currentMonth([aluguelRow, luzRow(22000)]),
          ],
        }),
      );

      expect(projection.fixedBillsDue).toBe(0);
    });

    it('adds the median of a bill not paid yet', () => {
      const projection = projectMonthEnd(
        makeOctoberInput({
          ledger: [
            ...billMonths([20000, 22000, 24000]),
            currentMonth([aluguelRow]),
          ],
        }),
      );

      expect(projection.fixedBillsDue).toBe(22000);
    });

    it('adds every bill on the first day of the month', () => {
      const projection = projectMonthEnd(
        makeOctoberInput({
          dayOfMonth: 1,
          ledger: [
            ...[SEPTEMBER, AUGUST, JULY].map((key) =>
              activeMonth(key, [aluguelRow, luzRow(22000)]),
            ),
            currentMonth([]),
          ],
        }),
      );

      expect(projection.fixedBillsDue).toBe(172000);
    });

    it('does not project a bill missing from the newest month', () => {
      const [, august, july] = billMonths([22000, 22000, 22000]);
      const projection = projectMonthEnd(
        makeOctoberInput({
          ledger: [
            activeMonth(SEPTEMBER, [windowRow(1000)]),
            august,
            july,
            currentMonth([]),
          ],
        }),
      );

      expect(projection.fixedBillsDue).toBe(0);
    });

    it('does not project a bill paid twice in the current month', () => {
      const projection = projectMonthEnd(
        makeOctoberInput({
          ledger: [
            ...billMonths([22000, 22000, 22000], false),
            currentMonth([
              luzRow(22000),
              makeRow({ day: 3, categoryId: 'luz', amount: 22000 }),
            ]),
          ],
        }),
      );

      expect(projection.fixedBillsDue).toBe(0);
    });

    it('excludes both rows of a bill paid twice in the newest month from variable', () => {
      const projection = projectMonthEnd(
        makeOctoberInput({
          ledger: [
            activeMonth(SEPTEMBER, [
              windowRow(1000),
              luzRow(22000),
              makeRow({ day: 26, categoryId: 'luz', amount: 22000 }),
            ]),
            activeMonth(AUGUST, [windowRow(1000), luzRow(22000)]),
            activeMonth(JULY, [windowRow(1000), luzRow(22000)]),
            currentMonth([luzRow(22000)]),
          ],
        }),
      );

      expect(projection.fixedBillsDue).toBe(0);
      expect(projection.variableRemaining).toBe(1000);
    });

    it('does not add a pending bill on top of the scheduled amount', () => {
      const projection = projectMonthEnd(
        makeOctoberInput({
          ledger: [
            ...billMonths([22000, 22000, 22000], false),
            currentMonth(
              [
                makeRow({
                  day: 28,
                  categoryId: 'luz',
                  amount: 22000,
                  pending: true,
                }),
              ],
              {
                pending: { totalIncome: 0, totalExpense: 22000 },
              },
            ),
          ],
        }),
      );

      expect(projection.fixedBillsDue).toBe(0);
    });

    it('does not turn a high-frequency category into a bill', () => {
      const projection = projectMonthEnd(
        makeOctoberInput({
          ledger: [
            ...[SEPTEMBER, AUGUST, JULY].map((key) =>
              activeMonth(key, [
                windowRow(1000),
                ...[1, 2, 3, 4, 5].map((day) =>
                  makeRow({ day, categoryId: 'mercado', amount: 8000 }),
                ),
              ]),
            ),
            currentMonth([]),
          ],
        }),
      );

      expect(projection.fixedBillsDue).toBe(0);
    });
  });

  describe('habits-based projection', () => {
    it('projects the historical window shape instead of a flat daily rate', () => {
      const projection = projectMonthEnd(
        makeOctoberInput({
          dayOfMonth: 15,
          ledger: [
            ...THIRTY_DAY_BASIS.map(shapeMonth),
            currentMonth([makeRow({ day: 10, amount: 500 })]),
          ],
        }),
      );

      expect(projection.variableRemaining).toBe(2500);
      expect(projection.paceDaily).toBe(33);
    });

    it('projects nothing when every basis month spends before the window', () => {
      const projection = projectMonthEnd(
        makeOctoberInput({
          dayOfMonth: 20,
          ledger: [
            ...THIRTY_DAY_BASIS.map(frontLoadedMonth),
            currentMonth([makeRow({ day: 5, amount: 3000 })]),
          ],
        }),
      );

      expect(projection.variableRemaining).toBe(0);
      expect(projection.paceDaily).toBe(150);
    });

    it('converges to the same remainder for a flat shape', () => {
      const projection = projectMonthEnd(
        makeOctoberInput({
          dayOfMonth: 15,
          ledger: [
            ...THIRTY_DAY_BASIS.map(flatMonth),
            currentMonth(dailyRows(15, 100)),
          ],
        }),
      );

      expect(projection.variableRemaining).toBe(1500);
      expect(projection.paceDaily).toBe(100);
    });

    it('projects the whole remaining window on day one with no spend', () => {
      const projection = projectMonthEnd(
        makeOctoberInput({
          dayOfMonth: 1,
          ledger: [...THIRTY_DAY_BASIS.map(flatMonth), currentMonth([])],
        }),
      );

      expect(projection.variableRemaining).toBe(2900);
      expect(projection.paceDaily).toBe(0);
    });

    it('projects nothing on the last day', () => {
      const projection = projectMonthEnd(
        makeOctoberInput({
          dayOfMonth: 31,
          ledger: [...THIRTY_DAY_BASIS.map(flatMonth), currentMonth([])],
        }),
      );

      expect(projection.daysRemaining).toBe(0);
      expect(projection.variableRemaining).toBe(0);
      expect(projection.paceDaily).toBe(0);
    });

    it('counts a short basis month as an empty window in the median', () => {
      const projection = projectMonthEnd(marchInput());

      expect(projection.variableRemaining).toBe(1000);
    });

    it('excludes a bill-like row inside the window', () => {
      const projection = projectMonthEnd(
        makeOctoberInput({
          dayOfMonth: 15,
          realized: { totalIncome: 0, totalExpense: 1000 },
          ledger: [
            ...THIRTY_DAY_BASIS.map(billInWindowMonth),
            currentMonth([makeRow({ day: 10, amount: 500 })]),
          ],
        }),
      );

      expect(projection.variableRemaining).toBe(500);
      expect(projection.paceDaily).toBe(33);
      expect(projection.fixedBillsDue).toBe(20000);
      expect(projection.accountedExpense).toBe(1000);
      expect(projection.expectedExpense).toBe(21500);
    });

    it('keeps the habits remainder when the current month runs at half speed', () => {
      const full = projectMonthEnd(
        makeOctoberInput({
          dayOfMonth: 15,
          ledger: [
            ...THIRTY_DAY_BASIS.map(flatMonth),
            currentMonth(dailyRows(15, 100)),
          ],
        }),
      );
      const half = projectMonthEnd(
        makeOctoberInput({
          dayOfMonth: 15,
          ledger: [
            ...THIRTY_DAY_BASIS.map(flatMonth),
            currentMonth(dailyRows(15, 50)),
          ],
        }),
      );

      expect(full.variableRemaining).toBe(1500);
      expect(half.variableRemaining).toBe(1500);
      expect(full.paceDaily).toBe(100);
      expect(half.paceDaily).toBe(50);
    });
  });

  describe('paced projection', () => {
    it('projects the paced month end beside the habits month end', () => {
      const projection = projectMonthEnd(
        makeInput({
          dayOfMonth: 8,
          realized: { totalIncome: 6000, totalExpense: 400 },
          ledger: [
            ...[AUGUST, JULY, JUNE].map((key) => pacedBasisMonth(key, 2260)),
            makeLedgerMonth(SEPTEMBER, {
              plainExpenses: dailyRows(8, 50),
            }),
          ],
        }),
      );

      expect(projection.paceDaily).toBe(50);
      expect(projection.paceRemaining).toBe(1100);
      expect(projection.paceBalance).toBe(2000);
      expect(projection.expectedBalance).toBe(840);
      expect((projection.paceBalance ?? 0) - projection.expectedBalance).toBe(
        1160,
      );
    });

    it('rounds the paced remainder once from the exact daily pace', () => {
      const projection = projectMonthEnd(
        makeOctoberInput({
          month: THIRTEEN_DAY_MONTH,
          dayOfMonth: 3,
          ledger: [
            ...[SEPTEMBER, AUGUST, JULY].map((key) => pacedBasisMonth(key, 0)),
            currentMonth([
              makeRow({ day: 1, amount: 34 }),
              makeRow({ day: 2, amount: 33 }),
              makeRow({ day: 3, amount: 33 }),
            ]),
          ],
        }),
      );

      expect(projection.paceDaily).toBe(33);
      expect(projection.paceRemaining).toBe(333);
    });

    it('has no paced figures without history', () => {
      const projection = projectMonthEnd(makeOctoberInput());

      expect(projection.hasHistory).toBe(false);
      expect(projection.paceRemaining).toBeNull();
      expect(projection.paceBalance).toBeNull();
    });

    it('ends the paced balance at the accounted expense on the last day', () => {
      const projection = projectMonthEnd(
        makeOctoberInput({
          dayOfMonth: 31,
          realized: { totalIncome: 6000, totalExpense: 400 },
          ledger: [...THIRTY_DAY_BASIS.map(flatMonth), currentMonth([])],
        }),
      );

      expect(projection.daysRemaining).toBe(0);
      expect(projection.paceRemaining).toBe(0);
      expect(projection.paceBalance).toBe(5600);
    });
  });

  describe('usual expense', () => {
    it('scales the median daily total expense of six basis months to the month length', () => {
      const projection = projectMonthEnd(
        makeOctoberInput({
          ledger: [
            activeMonth(SEPTEMBER, [], { totalExpense: 30000 }),
            activeMonth(AUGUST, [], { totalExpense: 31000 }),
            activeMonth(JULY, [], { totalExpense: 31000 }),
            activeMonth(JUNE, [], { totalExpense: 60000 }),
            activeMonth(MAY, [], { totalExpense: 62000 }),
            activeMonth(APRIL, [], { totalExpense: 60000 }),
            activeMonth(MARCH, [], { totalExpense: 0 }),
          ],
        }),
      );

      expect(projection.usualExpense).toBe(46500);
    });

    it('scales to February with 28 days', () => {
      const projection = projectMonthEnd(
        makeInput({
          month: {
            key: '2026-02',
            start: localMidnight('2026-02-01'),
            end: new Date('2026-03-01T02:59:59.999Z'),
            days: 28,
          },
          ledger: [
            activeMonth('2026-01', [], { totalExpense: 31000 }),
            activeMonth('2025-12', [], { totalExpense: 31000 }),
            activeMonth('2025-11', [], { totalExpense: 30000 }),
          ],
        }),
      );

      expect(projection.usualExpense).toBe(28000);
    });

    it('is null below three basis months', () => {
      const projection = projectMonthEnd(
        makeOctoberInput({
          ledger: [
            activeMonth(SEPTEMBER, [], { totalExpense: 30000 }),
            activeMonth(AUGUST, [], { totalExpense: 31000 }),
          ],
        }),
      );

      expect(projection.usualExpense).toBeNull();
    });
  });

  describe('recurring not yet generated', () => {
    it('counts a rule that starts inside the month', () => {
      const projection = projectMonthEnd(
        makeInput({ recurringRules: [makeRule()] }),
      );

      expect(projection.recurringNotYetGenerated).toEqual({
        totalIncome: 0,
        totalExpense: 5000,
      });
    });

    it('splits income and expense rules', () => {
      const projection = projectMonthEnd(
        makeInput({
          recurringRules: [
            makeRule(),
            makeRule({ id: 'rule-2', type: 'INCOME', amount: 20000 }),
          ],
        }),
      );

      expect(projection.recurringNotYetGenerated).toEqual({
        totalIncome: 20000,
        totalExpense: 5000,
      });
    });

    it('starts the cursor after lastGenerated', () => {
      const projection = projectMonthEnd(
        makeInput({
          recurringRules: [
            makeRule({ lastGenerated: localMidnight('2026-08-05') }),
          ],
        }),
      );

      expect(projection.recurringNotYetGenerated.totalExpense).toBe(5000);
    });

    it('counts nothing when the month occurrence was already generated', () => {
      const projection = projectMonthEnd(
        makeInput({
          recurringRules: [makeRule({ lastGenerated: SEPTEMBER_5 })],
        }),
      );

      expect(projection.recurringNotYetGenerated.totalExpense).toBe(0);
    });

    it('does not double count an occurrence materialized after lastGenerated was cleared', () => {
      const projection = projectMonthEnd(
        makeInput({
          recurringRules: [
            makeRule({
              startDate: localMidnight('2026-01-05'),
              lastGenerated: null,
              materializedDates: [SEPTEMBER_5],
            }),
          ],
        }),
      );

      expect(projection.recurringNotYetGenerated.totalExpense).toBe(0);
    });

    it('counts every occurrence of a weekly rule with interval 2', () => {
      const projection = projectMonthEnd(
        makeInput({
          recurringRules: [
            makeRule({
              frequency: RecurrenceFrequency.WEEKLY,
              interval: 2,
              amount: 1000,
              startDate: SEPTEMBER_1,
            }),
          ],
        }),
      );

      expect(projection.recurringNotYetGenerated.totalExpense).toBe(3000);
    });

    it('contributes nothing when a yearly anniversary is outside the month', () => {
      const projection = projectMonthEnd(
        makeInput({
          recurringRules: [
            makeRule({
              frequency: RecurrenceFrequency.YEARLY,
              startDate: localMidnight('2025-12-10'),
            }),
          ],
        }),
      );

      expect(projection.recurringNotYetGenerated.totalExpense).toBe(0);
    });

    it('follows the day drift of a monthly rule started on the 31st', () => {
      const projection = projectMonthEnd(
        makeInput({
          recurringRules: [
            makeRule({
              startDate: localMidnight('2026-01-31'),
              materializedDates: [localMidnight('2026-09-28')],
            }),
          ],
        }),
      );

      expect(projection.recurringNotYetGenerated.totalExpense).toBe(0);
    });

    it('stops at the rule end date inside the month', () => {
      const projection = projectMonthEnd(
        makeInput({
          recurringRules: [
            makeRule({
              frequency: RecurrenceFrequency.WEEKLY,
              amount: 1000,
              startDate: SEPTEMBER_1,
              endDate: localMidnight('2026-09-10'),
            }),
          ],
        }),
      );

      expect(projection.recurringNotYetGenerated.totalExpense).toBe(2000);
    });

    it('contributes nothing when lastGenerated is beyond the month end', () => {
      const projection = projectMonthEnd(
        makeInput({
          recurringRules: [
            makeRule({ lastGenerated: localMidnight('2026-10-05') }),
          ],
        }),
      );

      expect(projection.recurringNotYetGenerated.totalExpense).toBe(0);
    });

    it('stops at the safety cap when the stepper does not advance', () => {
      const projection = projectMonthEnd(
        makeInput({
          recurringRules: [makeRule({ amount: 1 })],
          nextOccurrence: (date) => date,
        }),
      );

      expect(projection.recurringNotYetGenerated.totalExpense).toBe(1000);
    });
  });

  describe('outputs', () => {
    it('sums realized, scheduled and recurring into expected income', () => {
      const projection = projectMonthEnd(
        makeInput({
          realized: { totalIncome: 100000, totalExpense: 0 },
          ledger: [
            makeLedgerMonth(SEPTEMBER, {
              pending: { totalIncome: 50000, totalExpense: 0 },
            }),
          ],
          recurringRules: [makeRule({ type: 'INCOME', amount: 20000 })],
        }),
      );

      expect(projection.expectedIncome).toBe(170000);
    });

    it('composes expected expense from accounted, fixed bills and variable remaining', () => {
      const projection = projectMonthEnd(
        makeOctoberInput({
          dayOfMonth: 15,
          realized: { totalIncome: 0, totalExpense: 1000 },
          ledger: [
            ...THIRTY_DAY_BASIS.map(billInWindowMonth),
            currentMonth([makeRow({ day: 10, amount: 500 })]),
          ],
        }),
      );

      expect(projection.expectedExpense).toBe(
        projection.accountedExpense +
          projection.fixedBillsDue +
          projection.variableRemaining,
      );
    });

    it('allows a negative expected balance', () => {
      const projection = projectMonthEnd(
        makeInput({
          realized: { totalIncome: 1000, totalExpense: 4000 },
        }),
      );

      expect(projection.expectedBalance).toBe(-3000);
    });

    it('passes realized and scheduled through unchanged', () => {
      const realized = { totalIncome: 1, totalExpense: 2 };
      const scheduled = { totalIncome: 3, totalExpense: 4 };

      const projection = projectMonthEnd(
        makeInput({
          realized,
          ledger: [makeLedgerMonth(SEPTEMBER, { pending: scheduled })],
        }),
      );

      expect(projection.realized).toEqual(realized);
      expect(projection.scheduled).toEqual(scheduled);
    });
  });
});
