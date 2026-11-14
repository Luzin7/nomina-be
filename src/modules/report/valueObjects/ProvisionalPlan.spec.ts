import {
  buildProvisionalPlan,
  type PlainExpenseOn,
  type ProvisionalPlan,
  type ProvisionalPlanInput,
} from './ProvisionalPlan';

const expense = (date: string, amount: number): PlainExpenseOn => ({
  date,
  amount,
});

const plan = (
  overrides: Partial<ProvisionalPlanInput> = {},
): ProvisionalPlanInput => ({
  today: '2026-11-15',
  daysInMonth: 30,
  expenses: [],
  spentCents: 0,
  recurringExpenseCents: 0,
  recurringDueCents: 0,
  ...overrides,
});

const provisionalOf = (result: ProvisionalPlan) => {
  if (result.kind !== 'provisional') throw new Error(result.kind);
  return result;
};

const routineDays = (
  month: string,
  from: number,
  to: number,
  amount: number,
): PlainExpenseOn[] =>
  Array.from({ length: to - from + 1 }, (_, index) =>
    expense(`${month}-${String(from + index).padStart(2, '0')}`, amount),
  );

describe('buildProvisionalPlan', () => {
  it('has nothing observed without plain expenses', () => {
    expect(buildProvisionalPlan(plan())).toEqual({ kind: 'nothing-observed' });
  });

  it('ignores expenses dated after today', () => {
    const result = buildProvisionalPlan(
      plan({ expenses: [expense('2026-11-20', 5_000)] }),
    );

    expect(result).toEqual({ kind: 'nothing-observed' });
  });

  it('gives an initial figure from a single expense on day 1', () => {
    const result = provisionalOf(
      buildProvisionalPlan(
        plan({
          today: '2026-11-01',
          expenses: [expense('2026-11-01', 30_000)],
          spentCents: 30_000,
        }),
      ),
    );

    expect(result.planTotalCents).toBe(154_286);
    expect(result.basis).toEqual({
      confidence: 'initial',
      frozen: false,
      recurringExpenseCents: 0,
      recurringDueCents: 0,
      dailyRateCents: 4_286,
      observedDays: 1,
      activeDays: 1,
      minActiveDays: 5,
      windowStart: '2026-11-01',
      windowEnd: '2026-11-01',
    });
  });

  it('counts the first days as at least seven', () => {
    const result = provisionalOf(
      buildProvisionalPlan(
        plan({
          today: '2026-11-03',
          expenses: routineDays('2026-11', 1, 3, 10_000),
        }),
      ),
    );

    expect(result.basis.dailyRateCents).toBe(4_286);
    expect(result.basis.observedDays).toBe(3);
  });

  it('caps each expense at three times the median from the third expense', () => {
    const result = provisionalOf(
      buildProvisionalPlan(
        plan({
          today: '2026-11-04',
          expenses: [
            expense('2026-11-02', 1_000),
            expense('2026-11-03', 1_000),
            expense('2026-11-04', 100_000),
          ],
        }),
      ),
    );

    expect(result.basis.dailyRateCents).toBe(714);
  });

  it('does not cap with fewer than three expenses', () => {
    const result = provisionalOf(
      buildProvisionalPlan(
        plan({
          today: '2026-11-03',
          expenses: [
            expense('2026-11-02', 1_000),
            expense('2026-11-03', 100_000),
          ],
        }),
      ),
    );

    expect(result.basis.dailyRateCents).toBe(14_429);
  });

  it('caps each day at three times the median day from five active days', () => {
    const result = provisionalOf(
      buildProvisionalPlan(
        plan({
          today: '2026-11-05',
          expenses: [
            ...routineDays('2026-11', 1, 4, 1_000),
            expense('2026-11-05', 100_000),
          ],
        }),
      ),
    );

    expect(result.basis.confidence).toBe('observed');
    expect(result.basis.dailyRateCents).toBe(1_400);
  });

  it('stays initial with four active days', () => {
    const result = provisionalOf(
      buildProvisionalPlan(
        plan({
          today: '2026-11-05',
          expenses: routineDays('2026-11', 1, 4, 1_000),
        }),
      ),
    );

    expect(result.basis.confidence).toBe('initial');
  });

  it('bounds a single huge purchase among routine days', () => {
    const routine = routineDays('2026-11', 1, 9, 2_000);
    const withPurchase = buildProvisionalPlan(
      plan({
        today: '2026-11-10',
        expenses: [...routine, expense('2026-11-10', 5_000_000)],
        spentCents: 5_018_000,
      }),
    );
    const withoutPurchase = buildProvisionalPlan(
      plan({
        today: '2026-11-10',
        expenses: [...routine, expense('2026-11-10', 2_000)],
        spentCents: 20_000,
      }),
    );

    expect(provisionalOf(withPurchase).basis.dailyRateCents).toBe(
      Math.round((9 * 2_000 + 6_000) / 10),
    );
    expect(provisionalOf(withoutPurchase).basis.dailyRateCents).toBe(2_000);
  });

  it('never plans below spent plus recurring due in the first month', () => {
    const result = provisionalOf(
      buildProvisionalPlan(
        plan({
          today: '2026-11-29',
          expenses: [expense('2026-11-29', 1_000)],
          spentCents: 900_000,
          recurringDueCents: 250_000,
        }),
      ),
    );

    expect(result.planTotalCents).toBeGreaterThanOrEqual(1_150_000);
    expect(result.planTotalCents - 900_000 - 250_000).toBe(
      Math.round((1_000 / 7) * 1),
    );
  });

  it('keeps spendable free of the rate noise already behind it', () => {
    const result = provisionalOf(
      buildProvisionalPlan(
        plan({
          today: '2026-11-10',
          expenses: routineDays('2026-11', 1, 10, 3_000),
          spentCents: 30_000,
          recurringDueCents: 40_000,
        }),
      ),
    );

    expect(result.planTotalCents).toBe(30_000 + 40_000 + 3_000 * 20);
  });

  describe('frozen window', () => {
    const october = routineDays('2026-10', 1, 10, 1_000);

    it('freezes on the days before the month once they hold five active days', () => {
      const result = provisionalOf(
        buildProvisionalPlan(
          plan({
            today: '2026-11-03',
            expenses: october,
            recurringExpenseCents: 500_000,
          }),
        ),
      );

      expect(result.planTotalCents).toBe(509_677);
      expect(result.basis).toMatchObject({
        confidence: 'observed',
        frozen: true,
        recurringExpenseCents: 500_000,
        observedDays: 31,
        activeDays: 10,
        windowStart: '2026-10-01',
        windowEnd: '2026-10-31',
      });
    });

    it('is stable all month whatever is spent in it', () => {
      const early = buildProvisionalPlan(
        plan({
          today: '2026-11-03',
          expenses: october,
          recurringExpenseCents: 500_000,
        }),
      );
      const late = buildProvisionalPlan(
        plan({
          today: '2026-11-28',
          expenses: [...october, ...routineDays('2026-11', 1, 28, 90_000)],
          spentCents: 2_520_000,
          recurringExpenseCents: 500_000,
          recurringDueCents: 100_000,
        }),
      );

      expect(provisionalOf(late).planTotalCents).toBe(
        provisionalOf(early).planTotalCents,
      );
    });

    it('can sit below spent, which is a real over-plan signal', () => {
      const result = provisionalOf(
        buildProvisionalPlan(
          plan({
            today: '2026-11-20',
            expenses: october,
            spentCents: 2_000_000,
            recurringExpenseCents: 0,
          }),
        ),
      );

      expect(result.planTotalCents).toBeLessThan(2_000_000);
    });

    it('starts the window at the first expense', () => {
      const result = provisionalOf(
        buildProvisionalPlan(
          plan({
            today: '2026-11-03',
            expenses: routineDays('2026-10', 21, 31, 1_000),
          }),
        ),
      );

      expect(result.basis).toMatchObject({
        windowStart: '2026-10-21',
        observedDays: 11,
      });
    });

    it('caps the window at 90 days', () => {
      const result = provisionalOf(
        buildProvisionalPlan(
          plan({
            today: '2026-11-03',
            expenses: [
              expense('2026-01-01', 1_000),
              ...routineDays('2026-10', 1, 10, 1_000),
            ],
          }),
        ),
      );

      expect(result.basis).toMatchObject({
        windowStart: '2026-08-03',
        observedDays: 90,
      });
    });
  });

  describe('month boundary', () => {
    const lastDays = routineDays('2026-11', 26, 30, 2_000);

    it('freezes on the first day of the next month with the last days behind it', () => {
      const result = provisionalOf(
        buildProvisionalPlan(
          plan({
            today: '2026-12-01',
            daysInMonth: 31,
            expenses: lastDays,
          }),
        ),
      );

      expect(result.basis).toMatchObject({
        frozen: true,
        windowStart: '2026-11-26',
        windowEnd: '2026-11-30',
      });
      expect(result.planTotalCents).toBe(62_000);
    });

    it('counts a expense on the first day of the month in the new month', () => {
      const result = provisionalOf(
        buildProvisionalPlan(
          plan({
            today: '2026-12-01',
            daysInMonth: 31,
            expenses: [...lastDays, expense('2026-12-01', 9_000_000)],
          }),
        ),
      );

      expect(result.planTotalCents).toBe(62_000);
    });

    it('stays unfrozen on the last day of the same month', () => {
      const result = provisionalOf(
        buildProvisionalPlan(plan({ today: '2026-11-30', expenses: lastDays })),
      );

      expect(result.basis.frozen).toBe(false);
    });
  });

  it('gives the same result on every run and does not mutate the input', () => {
    const input = plan({
      today: '2026-11-10',
      expenses: routineDays('2026-11', 1, 10, 3_000),
      spentCents: 30_000,
    });
    const snapshot = structuredClone(input);

    const first = buildProvisionalPlan(input);
    const second = buildProvisionalPlan(input);

    expect(second).toEqual(first);
    expect(input).toEqual(snapshot);
  });
});
