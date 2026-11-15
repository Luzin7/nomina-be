import { inferIncome } from './IncomeInference';

describe('inferIncome', () => {
  it('uses the median of the months with income', () => {
    expect(inferIncome([500_000, 520_000, 480_000])).toEqual({
      incomeCents: 500_000,
      incomeMonths: 3,
      zeroIncomeMonths: 0,
    });
  });

  it('does not drop to the lowest month when one is far below the median', () => {
    expect(inferIncome([500_000, 300_000, 520_000])).toMatchObject({
      incomeCents: 500_000,
    });
  });

  it('keeps a bonus month from inflating the base', () => {
    expect(inferIncome([500_000, 500_000, 1_000_000])).toMatchObject({
      incomeCents: 500_000,
    });
  });

  it('excludes a zero month from the median and counts it', () => {
    expect(inferIncome([0, 500_000, 520_000, 480_000])).toEqual({
      incomeCents: 500_000,
      incomeMonths: 3,
      zeroIncomeMonths: 1,
    });
  });

  it('rounds an even-count median to whole cents', () => {
    expect(inferIncome([500_001, 500_002, 500_003, 500_004])).toMatchObject({
      incomeCents: 500_003,
    });
  });

  it('is unavailable with fewer than 3 income months', () => {
    expect(inferIncome([0, 0, 500_000, 500_000])).toBeNull();
  });
});
