import { RecurrenceFrequency } from '@constants/enums';
import {
  buildMonthPace,
  expenseOccurrencesByDay,
  MonthPaceInput,
} from './MonthPace';
import { RecurringRuleSnapshot } from './MonthProjection';

function makeInput(overrides: Partial<MonthPaceInput> = {}): MonthPaceInput {
  return {
    month: '2026-11',
    daysInMonth: 30,
    today: 15,
    spentByDay: {},
    planTotalCents: 876_000,
    fixedByDay: {},
    ...overrides,
  };
}

function makeRule(
  overrides: Partial<RecurringRuleSnapshot> = {},
): RecurringRuleSnapshot {
  return {
    id: 'rule-1',
    type: 'EXPENSE',
    categoryId: null,
    amount: 200_000,
    frequency: RecurrenceFrequency.MONTHLY,
    interval: 1,
    startDate: new Date('2026-10-05T15:00:00.000Z'),
    endDate: null,
    lastGenerated: null,
    materializedDates: [],
    ...overrides,
  };
}

const nextMonth = (date: Date): Date =>
  new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 5, 15));

describe('buildMonthPace', () => {
  it('returns one entry per day of the month', () => {
    const pace = buildMonthPace(makeInput());

    expect(pace.days).toHaveLength(30);
    expect(pace.days[0].day).toBe(1);
    expect(pace.days[29].day).toBe(30);
  });

  it('accumulates spend up to today and leaves later days null', () => {
    const pace = buildMonthPace(
      makeInput({ spentByDay: { 1: 1_000, 3: 500, 15: 250 } }),
    );

    expect(pace.days[0].spentCents).toBe(1_000);
    expect(pace.days[1].spentCents).toBe(1_000);
    expect(pace.days[2].spentCents).toBe(1_500);
    expect(pace.days[14].spentCents).toBe(1_750);
    expect(pace.days[15].spentCents).toBeNull();
    expect(pace.days[29].spentCents).toBeNull();
  });

  it('reports zero spend before the first expense', () => {
    const pace = buildMonthPace(makeInput({ spentByDay: { 4: 100 } }));

    expect(pace.days[0].spentCents).toBe(0);
  });

  it('folds spend dated after today into today', () => {
    const pace = buildMonthPace(makeInput({ spentByDay: { 10: 100, 20: 50 } }));

    expect(pace.days[14].spentCents).toBe(150);
  });

  it('keeps every spent value null in a future month', () => {
    const pace = buildMonthPace(
      makeInput({ today: 0, spentByDay: { 3: 100 } }),
    );

    expect(pace.days.every((entry) => entry.spentCents === null)).toBe(true);
  });

  it('ends the plan exactly at the plan total', () => {
    const pace = buildMonthPace(makeInput({ planTotalCents: 100_007 }));

    expect(pace.days[29].planCents).toBe(100_007);
  });

  it('puts the remainder cents on the last day', () => {
    const pace = buildMonthPace(
      makeInput({ daysInMonth: 3, today: 3, planTotalCents: 10 }),
    );

    expect(pace.days.map((entry) => entry.planCents)).toEqual([3, 6, 10]);
  });

  it('makes the plan jump on the day of a fixed bill', () => {
    const pace = buildMonthPace(
      makeInput({ planTotalCents: 300_000, fixedByDay: { 5: 200_000 } }),
    );
    const variableDaily = 100_000 / 30;

    expect(pace.days[4].planCents! - pace.days[3].planCents!).toBeGreaterThan(
      200_000,
    );
    expect(pace.days[1].planCents! - pace.days[0].planCents!).toBeLessThan(
      variableDaily + 1,
    );
  });

  it('caps fixed bills at the plan total', () => {
    const pace = buildMonthPace(
      makeInput({
        planTotalCents: 150_000,
        fixedByDay: { 5: 200_000, 10: 100_000 },
      }),
    );

    expect(pace.days[3].planCents).toBe(0);
    expect(pace.days[4].planCents).toBe(150_000);
    expect(pace.days[29].planCents).toBe(150_000);
  });

  it('nulls every plan field without a budget', () => {
    const pace = buildMonthPace(makeInput({ planTotalCents: null }));

    expect(pace.planTotalCents).toBeNull();
    expect(pace.days.every((entry) => entry.planCents === null)).toBe(true);
  });
});

describe('expenseOccurrencesByDay', () => {
  const month = {
    start: new Date('2026-11-01T03:00:00.000Z'),
    end: new Date('2026-12-01T02:59:59.999Z'),
  };
  const dayOf = (date: Date): number => date.getUTCDate();

  it('places a monthly rule on its own day', () => {
    const byDay = expenseOccurrencesByDay({
      rules: [makeRule()],
      month,
      nextOccurrence: (date) => nextMonth(date),
      dayOf,
    });

    expect(byDay).toEqual({ 5: 200_000 });
  });

  it('ignores income rules', () => {
    const byDay = expenseOccurrencesByDay({
      rules: [makeRule({ type: 'INCOME' })],
      month,
      nextOccurrence: (date) => nextMonth(date),
      dayOf,
    });

    expect(byDay).toEqual({});
  });

  it('stops at the rule end date', () => {
    const byDay = expenseOccurrencesByDay({
      rules: [makeRule({ endDate: new Date('2026-10-31T00:00:00.000Z') })],
      month,
      nextOccurrence: (date) => nextMonth(date),
      dayOf,
    });

    expect(byDay).toEqual({});
  });
});
