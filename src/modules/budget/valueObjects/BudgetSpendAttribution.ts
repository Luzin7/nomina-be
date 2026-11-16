export type BudgetSpendAttribution = {
  spentByAllocation: Record<string, number>;
  unallocatedSpendByCategory: Record<string, number>;
  unallocatedSpent: number;
};

const sum = (values: number[]): number =>
  values.reduce((total, value) => total + value, 0);

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
