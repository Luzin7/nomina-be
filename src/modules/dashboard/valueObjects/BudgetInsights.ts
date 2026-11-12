import type {
  BudgetStatusAllocation,
  BudgetStatusResponse,
} from '@modules/budget/features/get-status/get-status.handler';
import type { AvailableToSpendInsight } from './AvailableToSpend';

const PT_BR = 'pt-BR';

const overageOf = (allocation: BudgetStatusAllocation): number =>
  allocation.spentCents - allocation.targetCents;

const byLargestOverageThenName = (
  a: BudgetStatusAllocation,
  b: BudgetStatusAllocation,
): number =>
  overageOf(b) - overageOf(a) ||
  a.categoryName.localeCompare(b.categoryName, PT_BR);

export function overBudgetInsight(
  spendableCents: number | null,
): AvailableToSpendInsight | null {
  if (spendableCents === null || spendableCents >= 0) return null;

  return {
    code: 'OVER_BUDGET',
    severity: 'high',
    args: { amount: Math.abs(spendableCents) },
    href: '/budget',
  };
}

export function categoryBreachInsight(
  budget: BudgetStatusResponse,
): AvailableToSpendInsight | null {
  if (!budget.exists) return null;

  const [worst] = budget.allocations
    .filter((allocation) => allocation.percentageUsed > 100)
    .sort(byLargestOverageThenName);
  if (!worst) return null;

  return {
    code: 'CATEGORY_BREACH',
    severity: 'medium',
    args: {
      categoryId: worst.categoryId,
      categoryName: worst.categoryName,
      amount: overageOf(worst),
    },
    href: `/budget?category=${worst.categoryId}`,
  };
}

export function unallocatedIncomeInsight(
  budget: BudgetStatusResponse,
): AvailableToSpendInsight | null {
  if (!budget.exists || budget.unallocatedIncomeCents <= 0) return null;

  return {
    code: 'UNALLOCATED_INCOME',
    severity: 'low',
    args: { amount: budget.unallocatedIncomeCents },
    href: '/budget',
  };
}
