import { distributeTargets } from './LargestRemainder';

describe('distributeTargets', () => {
  it('distributes the remainder so the targets sum to the income', () => {
    const targets = distributeTargets(100, [33, 33, 34]);

    expect(targets.reduce((total, target) => total + target, 0)).toBe(100);
    expect(targets).toEqual([33, 33, 34]);
  });

  it('gives the leftover cent to the largest remainder', () => {
    expect(distributeTargets(100, [33, 33, 33])).toEqual([34, 33, 33]);
  });

  it('keeps exact integer shares untouched', () => {
    expect(distributeTargets(1000, [25, 25, 50])).toEqual([250, 250, 500]);
  });

  it('handles a single cent income without losing money', () => {
    expect(distributeTargets(1, [50, 50])).toEqual([1, 0]);
  });

  it('returns zero for a zero-percentage allocation', () => {
    expect(distributeTargets(10_000, [0, 100])).toEqual([0, 10_000]);
  });

  it('returns an empty distribution for no allocations', () => {
    expect(distributeTargets(10_000, [])).toEqual([]);
  });
});
