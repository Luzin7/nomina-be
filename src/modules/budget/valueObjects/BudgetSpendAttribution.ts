import { TransactionType } from '@constants/enums';
import type { CategoryMapEntry } from '@modules/budget/repositories/contracts/BudgetRepository';
import { totalsByRoot } from '@modules/budget/valueObjects/BudgetPlanSides';

export type BudgetSpendAttribution = {
  spentByAllocation: Record<string, number>;
  unallocatedSpendByCategory: Record<string, number>;
  unallocatedSpent: number;
};

export type UnbudgetedCategory = {
  categoryId: string;
  categoryName: string;
  spendCents: number;
};

export type UnbudgetedSpendInput = {
  unallocatedSpendByCategory: Record<string, number>;
  parentByCategory: Record<string, string | null>;
  categoryMap: Record<string, CategoryMapEntry>;
  investRootCategoryId: string | null;
};

export type UnbudgetedSpend = {
  spendCents: number;
  categories: UnbudgetedCategory[];
};

const PT_BR = 'pt-BR';

const sum = (values: number[]): number =>
  values.reduce((total, value) => total + value, 0);

const byLargestSpendThenName = (
  a: UnbudgetedCategory,
  b: UnbudgetedCategory,
): number =>
  b.spendCents - a.spendCents ||
  a.categoryName.localeCompare(b.categoryName, PT_BR);

export function attributeSpendToAllocations(
  expensesByCategory: Record<string, number>,
  parentByCategory: Record<string, string | null>,
  allocatedCategoryIds: Set<string>,
): BudgetSpendAttribution {
  const spentByAllocation: Record<string, number> = {};
  const unallocatedSpendByCategory: Record<string, number> = {};

  for (const [categoryId, amount] of Object.entries(expensesByCategory)) {
    const allocationId = findNearestAllocatedCategory(
      categoryId,
      parentByCategory,
      allocatedCategoryIds,
    );

    if (allocationId === null) {
      unallocatedSpendByCategory[categoryId] =
        (unallocatedSpendByCategory[categoryId] ?? 0) + amount;
      continue;
    }

    spentByAllocation[allocationId] =
      (spentByAllocation[allocationId] ?? 0) + amount;
  }

  return {
    spentByAllocation,
    unallocatedSpendByCategory,
    unallocatedSpent: sum(Object.values(unallocatedSpendByCategory)),
  };
}

export function unbudgetedSpendOf({
  unallocatedSpendByCategory,
  parentByCategory,
  categoryMap,
  investRootCategoryId,
}: UnbudgetedSpendInput): UnbudgetedSpend {
  const spendByRoot = totalsByRoot(
    Object.entries(unallocatedSpendByCategory).map(([categoryId, cents]) => ({
      categoryId,
      cents,
    })),
    parentByCategory,
  );
  const unbudgetedRoots = Object.entries(spendByRoot).filter(
    ([rootId]) => rootId !== investRootCategoryId,
  );

  return {
    spendCents: sum(unbudgetedRoots.map(([, cents]) => cents)),
    categories: unbudgetedRoots
      .filter(([rootId]) => isAllocatableRoot(rootId, categoryMap))
      .map(([rootId, spendCents]) => ({
        categoryId: rootId,
        categoryName: categoryMap[rootId].name,
        spendCents,
      }))
      .sort(byLargestSpendThenName),
  };
}

function isAllocatableRoot(
  rootId: string,
  categoryMap: Record<string, CategoryMapEntry>,
): boolean {
  const entry = categoryMap[rootId];

  return (
    entry !== undefined &&
    entry.type === TransactionType.EXPENSE &&
    !entry.isHidden
  );
}

function findNearestAllocatedCategory(
  categoryId: string,
  parentByCategory: Record<string, string | null>,
  allocatedCategoryIds: Set<string>,
): string | null {
  const visited = new Set<string>();
  let currentId: string | null = categoryId;

  while (currentId !== null && !visited.has(currentId)) {
    if (allocatedCategoryIds.has(currentId)) return currentId;

    visited.add(currentId);
    currentId = parentByCategory[currentId] ?? null;
  }

  return null;
}
