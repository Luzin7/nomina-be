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

describe('projectMonthEnd', () => {
  describe('history', () => {
    it('has no history and no estimates with an empty ledger', () => {
      const projection = projectMonthEnd(makeOctoberInput());

      expect(projection.basisMonths).toBe(0);
      expect(projection.hasHistory).toBe(false);
      expect(projection.variableEstimate).toBe(0);
      expect(projection.usualExpense).toBeNull();
    });

    it('has no history with two active months and an inactive one on a single day', () => {
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
      expect(projection.variableEstimate).toBe(0);
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
      expect(projection.variableEstimate).toBe(2000);
    });

    it('uses four active months', () => {
      const projection = projectMonthEnd(
        makeOctoberInput({ ledger: windowMonths([1000, 2000, 3000, 4000]) }),
      );

      expect(projection.basisMonths).toBe(4);
      expect(projection.variableEstimate).toBe(2500);
    });

    it('uses five active months', () => {
      const projection = projectMonthEnd(
        makeOctoberInput({
          ledger: windowMonths([1000, 2000, 3000, 4000, 5000]),
        }),
      );

      expect(projection.basisMonths).toBe(5);
      expect(projection.variableEstimate).toBe(3000);
    });

    it('uses six active months', () => {
      const projection = projectMonthEnd(
        makeOctoberInput({
          ledger: windowMonths([1000, 2000, 3000, 4000, 5000, 6000]),
        }),
      );

      expect(projection.basisMonths).toBe(6);
      expect(projection.variableEstimate).toBe(3500);
    });

    it('uses only the newest six of seven active months', () => {
      const projection = projectMonthEnd(
        makeOctoberInput({
          ledger: windowMonths([1000, 2000, 3000, 4000, 5000, 6000, 900000]),
        }),
      );

      expect(projection.basisMonths).toBe(6);
      expect(projection.variableEstimate).toBe(3500);
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
      expect(projection.variableEstimate).toBe(3500);
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

      expect(projection.variableEstimate).toBe(1000);
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

      expect(projection.variableEstimate).toBe(23000);
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

      expect(projection.variableEstimate).toBe(177000);
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

      expect(projection.variableEstimate).toBe(1000);
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

      expect(projection.variableEstimate).toBe(1000);
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

      expect(projection.variableEstimate).toBe(1000);
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

      expect(projection.variableEstimate).toBe(1000);
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

      expect(projection.variableEstimate).toBe(1000);
    });
  });

  describe('variable window', () => {
    it('nets only the slice of today against what was already spent today', () => {
      const projection = projectMonthEnd(
        makeOctoberInput({
          ledger: [
            ...[SEPTEMBER, AUGUST, JULY].map((key) =>
              activeMonth(key, [
                windowRow(3000),
                makeRow({ day: 23, amount: 1000 }),
              ]),
            ),
            currentMonth([makeRow({ day: 23, amount: 400 })]),
          ],
        }),
      );

      expect(projection.variableEstimate).toBe(3600);
    });

    it('keeps the rest of the window after a big purchase today', () => {
      const projection = projectMonthEnd(
        makeOctoberInput({
          ledger: [
            ...[SEPTEMBER, AUGUST, JULY].map((key) =>
              activeMonth(key, [
                windowRow(3000),
                makeRow({ day: 23, amount: 2000 }),
              ]),
            ),
            currentMonth([
              makeRow({ day: 23, categoryId: 'cat-big', amount: 50000 }),
            ]),
          ],
        }),
      );

      expect(projection.variableEstimate).toBe(3000);
    });

    it('does not count today pending rows as spent today', () => {
      const projection = projectMonthEnd(
        makeOctoberInput({
          ledger: [
            ...[SEPTEMBER, AUGUST, JULY].map((key) =>
              activeMonth(key, [makeRow({ day: 23, amount: 1000 })]),
            ),
            currentMonth([makeRow({ day: 23, amount: 400, pending: true })]),
          ],
        }),
      );

      expect(projection.variableEstimate).toBe(1000);
    });

    it('rounds the median of two window values to integer cents', () => {
      const projection = projectMonthEnd(
        makeOctoberInput({ ledger: windowMonths([1000, 2001, 3000, 3001]) }),
      );

      expect(projection.variableEstimate).toBe(2501);
    });

    it('projects only the slice on the last day, clamped to a 30-day September', () => {
      const projection = projectMonthEnd(
        makeOctoberInput({
          dayOfMonth: 31,
          ledger: [
            activeMonth(SEPTEMBER, [
              makeRow({ day: 30, amount: 3000 }),
              windowRow(900),
            ]),
            activeMonth(AUGUST, [
              makeRow({ day: 31, amount: 3000 }),
              windowRow(900),
            ]),
            activeMonth(JULY, [
              makeRow({ day: 31, amount: 3000 }),
              windowRow(900),
            ]),
            currentMonth([]),
          ],
        }),
      );

      expect(projection.variableEstimate).toBe(3000);
    });

    it('does not count days 29 to 31 of January when February is on its last day', () => {
      const projection = projectMonthEnd(
        makeInput({
          month: {
            key: '2026-02',
            start: localMidnight('2026-02-01'),
            end: new Date('2026-03-01T02:59:59.999Z'),
            days: 28,
          },
          dayOfMonth: 28,
          ledger: [
            activeMonth('2026-01', [
              makeRow({ day: 28, amount: 2000 }),
              makeRow({ day: 29, amount: 9000 }),
            ]),
            activeMonth('2025-12', [
              makeRow({ day: 28, amount: 2000 }),
              makeRow({ day: 30, amount: 9000 }),
            ]),
            activeMonth('2025-11', [
              makeRow({ day: 28, amount: 2000 }),
              makeRow({ day: 29, amount: 9000 }),
            ]),
            makeLedgerMonth('2026-02'),
          ],
        }),
      );

      expect(projection.variableEstimate).toBe(2000);
    });

    it('clamps the slice day to the length of a February basis month', () => {
      const projection = projectMonthEnd(
        makeInput({
          month: {
            key: '2026-03',
            start: localMidnight('2026-03-01'),
            end: new Date('2026-04-01T02:59:59.999Z'),
            days: 31,
          },
          dayOfMonth: 30,
          ledger: [
            activeMonth('2026-02', [makeRow({ day: 28, amount: 4000 })]),
            activeMonth('2026-01', [makeRow({ day: 30, amount: 5000 })]),
            activeMonth('2025-12', [makeRow({ day: 30, amount: 1000 })]),
            makeLedgerMonth('2026-03'),
          ],
        }),
      );

      expect(projection.variableEstimate).toBe(4000);
    });

    it('matches the worked example of October 23', () => {
      const projection = projectMonthEnd(
        makeOctoberInput({
          realized: { totalIncome: 752943, totalExpense: 595323 },
          ledger: [
            activeMonth(SEPTEMBER, [aluguelRow, windowRow(12380)]),
            activeMonth(AUGUST, [aluguelRow, windowRow(51283)]),
            activeMonth(JULY, [aluguelRow, windowRow(30000)]),
            currentMonth([aluguelRow]),
          ],
        }),
      );

      expect(projection.variableEstimate).toBe(30000);
      expect(projection.expectedBalance).toBe(127620);
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

    it('adds every expense source and the variable estimate', () => {
      const projection = projectMonthEnd(
        makeOctoberInput({
          realized: { totalIncome: 0, totalExpense: 231015 },
          ledger: [
            ...windowMonths([64935, 64935, 64935]),
            currentMonth([], {
              pending: { totalIncome: 0, totalExpense: 118000 },
            }),
          ],
          recurringRules: [makeRule({ amount: 38990 })],
        }),
      );

      expect(projection.variableEstimate).toBe(64935);
      expect(projection.expectedExpense).toBe(452940);
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
