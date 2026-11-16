import { INVESTMENTS_ROOT_CATEGORY_ID } from '@constants/budgetCategory';

export type BudgetPlanSides = {
  controlledSpendCents: number;
  controlledPlanCents: number;
  investSpendCents: number;
  investPlanCents: number;
  unbudgetedSpendCents: number;
  overPlanCents: number;
};

type CategoryAmount = {
  categoryId: string;
  cents: number;
};

type RootTotals = Record<string, number>;

const rootOf = (
  categoryId: string,
  parentByCategory: Record<string, string | null>,
): string => parentByCategory[categoryId] ?? categoryId;

const isInvestments = (rootId: string): boolean =>
  rootId === INVESTMENTS_ROOT_CATEGORY_ID;

const sumByRoot = (
  amounts: ReadonlyArray<CategoryAmount>,
  parentByCategory: Record<string, string | null>,
): RootTotals => {
  const totals: RootTotals = {};

  for (const { categoryId, cents } of amounts) {
    const rootId = rootOf(categoryId, parentByCategory);
    totals[rootId] = (totals[rootId] ?? 0) + cents;
  }

  return totals;
};

const totalByRoot = (
  totals: RootTotals,
  keep: (rootId: string) => boolean,
): number =>
  Object.entries(totals).reduce(
    (total, [rootId, cents]) => (keep(rootId) ? total + cents : total),
    0,
  );

export function zeroPlanSides(): BudgetPlanSides {
  return {
    controlledSpendCents: 0,
    controlledPlanCents: 0,
    investSpendCents: 0,
    investPlanCents: 0,
    unbudgetedSpendCents: 0,
    overPlanCents: 0,
  };
}

export function splitBudgetPlanSides(
  allocations: ReadonlyArray<{ categoryId: string; targetCents: number }>,
  expensesByCategory: Record<string, number>,
  parentByCategory: Record<string, string | null>,
): BudgetPlanSides {
  const allocatedRoots = new Set(
    allocations.map(({ categoryId }) => rootOf(categoryId, parentByCategory)),
  );
  const planByRoot = sumByRoot(
    allocations.map(({ categoryId, targetCents }) => ({
      categoryId,
      cents: targetCents,
    })),
    parentByCategory,
  );
  const spendByRoot = sumByRoot(
    Object.entries(expensesByCategory).map(([categoryId, cents]) => ({
      categoryId,
      cents,
    })),
    parentByCategory,
  );
  const controlledSpendCents = totalByRoot(
    spendByRoot,
    (rootId) => allocatedRoots.has(rootId) && !isInvestments(rootId),
  );
  const controlledPlanCents = totalByRoot(
    planByRoot,
    (rootId) => allocatedRoots.has(rootId) && !isInvestments(rootId),
  );

  return {
    controlledSpendCents,
    controlledPlanCents,
    investSpendCents: totalByRoot(spendByRoot, isInvestments),
    investPlanCents: totalByRoot(planByRoot, isInvestments),
    unbudgetedSpendCents: totalByRoot(
      spendByRoot,
      (rootId) => !allocatedRoots.has(rootId) && !isInvestments(rootId),
    ),
    overPlanCents: Math.max(0, controlledSpendCents - controlledPlanCents),
  };
}
