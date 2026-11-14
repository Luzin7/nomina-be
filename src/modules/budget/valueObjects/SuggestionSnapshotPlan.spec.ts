import type { BudgetSnapshot } from '@modules/budget/repositories/contracts/BudgetRepository';
import { planSuggestionSnapshot } from './SuggestionSnapshotPlan';

function makeSnapshot(overrides: Partial<BudgetSnapshot> = {}): BudgetSnapshot {
  return {
    id: 'snapshot-1',
    workspaceId: 'workspace-1',
    effectiveFrom: new Date('2026-10-01T03:00:00.000Z'),
    monthlyIncome: null,
    mode: 'fixed',
    allocations: [
      {
        id: 'allocation-1',
        categoryId: 'housing',
        categoryName: 'Moradia',
        groupName: 'Essenciais',
        groupOrder: 0,
        categoryOrder: 0,
        percentageOfIncome: null,
        targetCents: 250_000,
      },
    ],
    ...overrides,
  };
}

const SPLIT = {
  kind: 'split' as const,
  allocations: [
    {
      categoryId: 'housing',
      groupName: 'Essenciais',
      groupOrder: 0,
      categoryOrder: 0,
      targetCents: 300_000,
    },
  ],
};

describe('planSuggestionSnapshot', () => {
  it('keeps the allocations and derives their percentages when income is accepted', () => {
    expect(
      planSuggestionSnapshot(makeSnapshot(), {
        kind: 'income',
        monthlyIncome: 1_000_000,
      }),
    ).toEqual({
      monthlyIncome: 1_000_000,
      mode: 'fixed',
      allocations: [
        {
          categoryId: 'housing',
          groupName: 'Essenciais',
          groupOrder: 0,
          categoryOrder: 0,
          percentageOfIncome: 25,
          targetCents: 250_000,
        },
      ],
    });
  });

  it('creates an allocation-free snapshot when income is accepted with no snapshot', () => {
    expect(
      planSuggestionSnapshot(null, { kind: 'income', monthlyIncome: 500_000 }),
    ).toEqual({
      monthlyIncome: 500_000,
      mode: 'percentage',
      allocations: [],
    });
  });

  it('keeps the existing income and derives percentages when a split is accepted', () => {
    const plan = planSuggestionSnapshot(
      makeSnapshot({ monthlyIncome: 1_000_000 }),
      SPLIT,
    );

    expect(plan.monthlyIncome).toBe(1_000_000);
    expect(plan.mode).toBe('fixed');
    expect(plan.allocations[0]).toMatchObject({
      percentageOfIncome: 30,
      targetCents: 300_000,
    });
  });

  it('leaves income and percentages null when a split is accepted without income', () => {
    const plan = planSuggestionSnapshot(null, SPLIT);

    expect(plan.monthlyIncome).toBeNull();
    expect(plan.allocations[0].percentageOfIncome).toBeNull();
  });
});
