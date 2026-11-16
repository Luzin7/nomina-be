import { INVESTMENTS_CATEGORY_NAME } from '@constants/incomeCategories';
import { TransactionType } from '@constants/enums';
import type { CategoryMapEntry } from '@modules/budget/repositories/contracts/BudgetRepository';

export const PLAN_SIDE_KEYS = [
  'controlledSpendCents',
  'controlledPlanCents',
  'investSpendCents',
  'investPlanCents',
  'unbudgetedSpendCents',
  'overPlanCents',
] as const;

export type BudgetPlanSides = Record<(typeof PLAN_SIDE_KEYS)[number], number>;

export type PlanSidesInput = {
  allocations: ReadonlyArray<{ categoryId: string; targetCents: number }>;
  spentByAllocation: Record<string, number>;
  unallocatedSpent: number;
  parentByCategory: Record<string, string | null>;
  investRootCategoryId: string | null;
};

type CategoryAmount = { categoryId: string; cents: number };

export const rootOf = (
  categoryId: string,
  parentByCategory: Record<string, string | null>,
): string => parentByCategory[categoryId] ?? categoryId;

export const parentMapOf = (
  categoryMap: Record<string, CategoryMapEntry>,
): Record<string, string | null> =>
  Object.fromEntries(
    Object.entries(categoryMap).map(([id, entry]) => [id, entry.parentId]),
  );

export const resolveInvestmentsRootId = (
  categoryMap: Record<string, CategoryMapEntry>,
): string | null =>
  Object.entries(categoryMap).find(
    ([, entry]) =>
      entry.name === INVESTMENTS_CATEGORY_NAME &&
      entry.type === TransactionType.EXPENSE &&
      entry.parentId === null,
  )?.[0] ?? null;

const totalsByRoot = (
  amounts: ReadonlyArray<CategoryAmount>,
  parentByCategory: Record<string, string | null>,
): Record<string, number> => {
  const totals: Record<string, number> = {};

  for (const { categoryId, cents } of amounts) {
    const rootId = rootOf(categoryId, parentByCategory);
    totals[rootId] = (totals[rootId] ?? 0) + cents;
  }

  return totals;
};

const totalByRoot = (
  totals: Record<string, number>,
  keep: (rootId: string) => boolean,
): number =>
  Object.entries(totals).reduce(
    (total, [rootId, cents]) => (keep(rootId) ? total + cents : total),
    0,
  );

export const zeroPlanSides = (): BudgetPlanSides =>
  Object.fromEntries(PLAN_SIDE_KEYS.map((key) => [key, 0])) as BudgetPlanSides;

export const pickPlanSides = (source: BudgetPlanSides): BudgetPlanSides =>
  Object.fromEntries(
    PLAN_SIDE_KEYS.map((key) => [key, source[key]]),
  ) as BudgetPlanSides;

export function splitBudgetPlanSides({
  allocations,
  spentByAllocation,
  unallocatedSpent,
  parentByCategory,
  investRootCategoryId,
}: PlanSidesInput): BudgetPlanSides {
  const isInvest = (rootId: string): boolean => rootId === investRootCategoryId;
  const isControlled = (rootId: string): boolean => !isInvest(rootId);
  const planByRoot = totalsByRoot(
    allocations.map(({ categoryId, targetCents }) => ({
      categoryId,
      cents: targetCents,
    })),
    parentByCategory,
  );
  const spendByRoot = totalsByRoot(
    Object.entries(spentByAllocation).map(([categoryId, cents]) => ({
      categoryId,
      cents,
    })),
    parentByCategory,
  );
  const controlledSpendCents = totalByRoot(spendByRoot, isControlled);
  const controlledPlanCents = totalByRoot(planByRoot, isControlled);

  return {
    controlledSpendCents,
    controlledPlanCents,
    investSpendCents: totalByRoot(spendByRoot, isInvest),
    investPlanCents: totalByRoot(planByRoot, isInvest),
    unbudgetedSpendCents: unallocatedSpent,
    overPlanCents: Math.max(0, controlledSpendCents - controlledPlanCents),
  };
}

export const controlledCategoryIdsOf = (
  allocations: ReadonlyArray<{ categoryId: string }>,
  parentByCategory: Record<string, string | null>,
  investRootCategoryId: string | null,
): Set<string> =>
  new Set(
    allocations
      .filter(
        ({ categoryId }) =>
          rootOf(categoryId, parentByCategory) !== investRootCategoryId,
      )
      .map(({ categoryId }) => categoryId),
  );

export const controlledRootIdsOf = (
  allocations: ReadonlyArray<{ categoryId: string }>,
  parentByCategory: Record<string, string | null>,
  investRootCategoryId: string | null,
): Set<string> =>
  new Set(
    allocations
      .map(({ categoryId }) => rootOf(categoryId, parentByCategory))
      .filter((rootId) => rootId !== investRootCategoryId),
  );
