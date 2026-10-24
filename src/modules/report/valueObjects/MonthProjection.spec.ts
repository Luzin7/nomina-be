import { RECURRING_GENERATION_TIMEZONE } from '@constants/timezone';
import { RecurrenceFrequency } from '@constants/enums';
import { DayJsDateProvider } from '@providers/date/implementations/Dayjs';
import { nextOccurrence } from '@utils/installmentSchedule';
import {
  BasisMonth,
  MonthProjectionInput,
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

const makeBasisMonth = (overrides: Partial<BasisMonth> = {}): BasisMonth => ({
  start: localMidnight('2026-08-01'),
  days: 31,
  totalExpense: 0,
  variableExpense: 31000,
  ...overrides,
});

const augustBasis = makeBasisMonth();
const julyBasis = makeBasisMonth({ start: localMidnight('2026-07-01') });
const juneBasis = makeBasisMonth({
  start: localMidnight('2026-06-01'),
  days: 30,
});

const makeInput = (
  overrides: Partial<MonthProjectionInput> = {},
): MonthProjectionInput => ({
  month: {
    start: SEPTEMBER_1,
    end: new Date('2026-10-01T02:59:59.999Z'),
    days: 30,
  },
  dayOfMonth: 10,
  realized: { totalIncome: 0, totalExpense: 0 },
  scheduled: { totalIncome: 0, totalExpense: 0 },
  variableExpenseToday: 0,
  basis: [],
  firstActivityAt: localMidnight('2026-01-01'),
  recurringRules: [],
  nextOccurrence: stepRule,
  ...overrides,
});

describe('projectMonthEnd', () => {
  describe('history', () => {
    it('has no history and no estimates with zero basis months', () => {
      const projection = projectMonthEnd(makeInput());

      expect(projection.basisMonths).toBe(0);
      expect(projection.hasHistory).toBe(false);
      expect(projection.variableEstimate).toBe(0);
      expect(projection.usualExpense).toBeNull();
    });

    it('counts one basis month', () => {
      const projection = projectMonthEnd(makeInput({ basis: [augustBasis] }));

      expect(projection.basisMonths).toBe(1);
      expect(projection.hasHistory).toBe(true);
    });

    it('counts two basis months', () => {
      const projection = projectMonthEnd(
        makeInput({ basis: [augustBasis, julyBasis] }),
      );

      expect(projection.basisMonths).toBe(2);
    });

    it('counts three basis months', () => {
      const projection = projectMonthEnd(
        makeInput({ basis: [augustBasis, julyBasis, juneBasis] }),
      );

      expect(projection.basisMonths).toBe(3);
    });

    it('excludes a basis month where the first activity happened in the middle', () => {
      const projection = projectMonthEnd(
        makeInput({
          basis: [augustBasis, julyBasis, juneBasis],
          firstActivityAt: localMidnight('2026-07-15'),
        }),
      );

      expect(projection.basisMonths).toBe(1);
    });

    it('counts a basis month that starts exactly on the first activity', () => {
      const projection = projectMonthEnd(
        makeInput({
          basis: [augustBasis, julyBasis],
          firstActivityAt: localMidnight('2026-08-01'),
        }),
      );

      expect(projection.basisMonths).toBe(1);
    });

    it('counts no basis month without first activity', () => {
      const projection = projectMonthEnd(
        makeInput({ basis: [augustBasis], firstActivityAt: null }),
      );

      expect(projection.basisMonths).toBe(0);
    });
  });

  describe('variable estimate', () => {
    it('projects the daily rate over the remaining days plus today remainder', () => {
      const projection = projectMonthEnd(
        makeInput({
          basis: [augustBasis],
          dayOfMonth: 10,
          variableExpenseToday: 400,
        }),
      );

      expect(projection.variableEstimate).toBe(20600);
    });

    it('pulls nothing back when spending is already above the baseline', () => {
      const projection = projectMonthEnd(
        makeInput({
          basis: [augustBasis],
          dayOfMonth: 10,
          variableExpenseToday: 1500,
        }),
      );

      expect(projection.variableEstimate).toBe(20000);
    });

    it('only completes today on the last day of the month', () => {
      const projection = projectMonthEnd(
        makeInput({
          basis: [augustBasis],
          dayOfMonth: 30,
          variableExpenseToday: 400,
        }),
      );

      expect(projection.variableEstimate).toBe(600);
    });

    it('uses the median with three months and an outlier', () => {
      const outlierBasis = makeBasisMonth({
        start: localMidnight('2026-06-01'),
        days: 30,
        variableExpense: 150000,
      });

      const projection = projectMonthEnd(
        makeInput({
          basis: [augustBasis, julyBasis, outlierBasis],
          dayOfMonth: 30,
        }),
      );

      expect(projection.variableEstimate).toBe(1000);
    });

    it('uses the mean of the two rates with two months', () => {
      const projection = projectMonthEnd(
        makeInput({
          basis: [
            augustBasis,
            makeBasisMonth({
              start: localMidnight('2026-07-01'),
              variableExpense: 62000,
            }),
          ],
          dayOfMonth: 30,
        }),
      );

      expect(projection.variableEstimate).toBe(1500);
    });

    it('rounds the estimate to integer cents', () => {
      const projection = projectMonthEnd(
        makeInput({
          basis: [makeBasisMonth({ variableExpense: 100 })],
          dayOfMonth: 30,
        }),
      );

      expect(projection.variableEstimate).toBe(3);
    });
  });

  describe('usual expense', () => {
    it('scales the median daily total expense to the month length', () => {
      const projection = projectMonthEnd(
        makeInput({ basis: [makeBasisMonth({ totalExpense: 310000 })] }),
      );

      expect(projection.usualExpense).toBe(300000);
    });

    it('scales to February with 28 days', () => {
      const projection = projectMonthEnd(
        makeInput({
          month: {
            start: localMidnight('2026-02-01'),
            end: new Date('2026-03-01T02:59:59.999Z'),
            days: 28,
          },
          basis: [
            makeBasisMonth({
              start: localMidnight('2026-01-01'),
              totalExpense: 310000,
            }),
          ],
        }),
      );

      expect(projection.usualExpense).toBe(280000);
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
          scheduled: { totalIncome: 50000, totalExpense: 0 },
          recurringRules: [makeRule({ type: 'INCOME', amount: 20000 })],
        }),
      );

      expect(projection.expectedIncome).toBe(170000);
    });

    it('adds every expense source and the variable estimate', () => {
      const projection = projectMonthEnd(
        makeInput({
          basis: [makeBasisMonth({ variableExpense: 96100 })],
          dayOfMonth: 10,
          variableExpenseToday: 165,
          realized: { totalIncome: 0, totalExpense: 231015 },
          scheduled: { totalIncome: 0, totalExpense: 118000 },
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

      const projection = projectMonthEnd(makeInput({ realized, scheduled }));

      expect(projection.realized).toEqual(realized);
      expect(projection.scheduled).toEqual(scheduled);
    });
  });
});
