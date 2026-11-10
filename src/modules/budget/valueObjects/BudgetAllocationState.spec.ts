import { resolveAllocationState } from './BudgetAllocationState';

describe('resolveAllocationState', () => {
  it('is balanced when the plan equals the income', () => {
    expect(resolveAllocationState(100_000, 100_000)).toBe('balanced');
  });

  it('is under when the plan is below the income', () => {
    expect(resolveAllocationState(100_000, 80_000)).toBe('under');
  });

  it('is over when the plan exceeds the income', () => {
    expect(resolveAllocationState(100_000, 130_000)).toBe('over');
  });
});
