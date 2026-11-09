import { nextStrictlyFutureOccurrence } from './MonthlyOccurrence';

describe('nextStrictlyFutureOccurrence', () => {
  it('keeps the current month when the day is still ahead', () => {
    expect(
      nextStrictlyFutureOccurrence({ year: 2026, month: 1, day: 10 }, 15),
    ).toEqual({ year: 2026, month: 1, day: 15 });
  });

  it('moves to the next month when the day is today', () => {
    expect(
      nextStrictlyFutureOccurrence({ year: 2026, month: 1, day: 15 }, 15),
    ).toEqual({ year: 2026, month: 2, day: 15 });
  });

  it('clamps day 31 to the last day of February', () => {
    expect(
      nextStrictlyFutureOccurrence({ year: 2026, month: 2, day: 10 }, 31),
    ).toEqual({ year: 2026, month: 2, day: 28 });

    expect(
      nextStrictlyFutureOccurrence({ year: 2026, month: 1, day: 31 }, 31),
    ).toEqual({ year: 2026, month: 2, day: 28 });
  });

  it('clamps day 31 to the last day of a 30-day month', () => {
    expect(
      nextStrictlyFutureOccurrence({ year: 2026, month: 3, day: 31 }, 31),
    ).toEqual({ year: 2026, month: 4, day: 30 });
  });

  it('rolls over to January of the next year', () => {
    expect(
      nextStrictlyFutureOccurrence({ year: 2026, month: 12, day: 20 }, 20),
    ).toEqual({ year: 2027, month: 1, day: 20 });
  });
});
