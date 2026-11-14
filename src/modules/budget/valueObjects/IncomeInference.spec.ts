import { inferIncome } from './IncomeInference';

describe('inferIncome', () => {
  it('uses the median when every month is within 80% of it', () => {
    expect(inferIncome([500_000, 520_000, 480_000])).toEqual({
      incomeCents: 500_000,
      base: 'median',
      incomeMonths: 3,
      zeroIncomeMonths: 0,
    });
  });

  it('treats a month at exactly 80% of the median as stable', () => {
    expect(inferIncome([500_000, 400_000, 500_000])).toMatchObject({
      incomeCents: 500_000,
      base: 'median',
    });
  });

  it('uses the lowest month when one falls below 80% of the median', () => {
    expect(inferIncome([500_000, 399_999, 500_000])).toMatchObject({
      incomeCents: 399_999,
      base: 'lowest',
    });
  });

  it('keeps a bonus month from inflating the base', () => {
    expect(inferIncome([500_000, 500_000, 1_000_000])).toMatchObject({
      incomeCents: 500_000,
      base: 'median',
    });
  });

  it('flags a zero month as unstable and excludes it from the base', () => {
    expect(inferIncome([0, 500_000, 600_000, 550_000])).toEqual({
      incomeCents: 500_000,
      base: 'lowest',
      incomeMonths: 3,
      zeroIncomeMonths: 1,
    });
  });

  it('is unavailable with fewer than 3 income months', () => {
    expect(inferIncome([0, 0, 500_000, 500_000])).toBeNull();
  });
});
