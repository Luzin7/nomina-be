export type BudgetSpendAttribution = {
  spentByAllocation: Record<string, number>;
  unallocatedSpent: number;
};

export function attributeSpendToAllocations(
  expensesByCategory: Record<string, number>,
  parentByCategory: Record<string, string | null>,
  allocatedCategoryIds: Set<string>,
): BudgetSpendAttribution {
  const spentByAllocation: Record<string, number> = {};
  let unallocatedSpent = 0;

  for (const [categoryId, amount] of Object.entries(expensesByCategory)) {
    const allocationId = findNearestAllocatedCategory(
      categoryId,
      parentByCategory,
      allocatedCategoryIds,
    );

    if (allocationId === null) {
      unallocatedSpent += amount;
      continue;
    }

    spentByAllocation[allocationId] =
      (spentByAllocation[allocationId] ?? 0) + amount;
  }

  return { spentByAllocation, unallocatedSpent };
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
