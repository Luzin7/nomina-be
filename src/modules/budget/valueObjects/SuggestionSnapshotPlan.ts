import { BUDGET_MODE_DEFAULT, type BudgetMode } from '@constants/enums';
import type {
  BudgetSnapshot,
  SaveBudgetAllocationInput,
  SuggestionSnapshotWrite,
} from '@modules/budget/repositories/contracts/BudgetRepository';

export type SuggestionSnapshotPlan = {
  monthlyIncome: number | null;
  mode: BudgetMode;
  allocations: SaveBudgetAllocationInput[];
};

const PERCENT = 100;

const percentageOf = (
  targetCents: number,
  monthlyIncome: number | null,
): number | null =>
  monthlyIncome === null
    ? null
    : Math.round((targetCents * PERCENT) / monthlyIncome);

export function planSuggestionSnapshot(
  current: BudgetSnapshot | null,
  write: SuggestionSnapshotWrite,
): SuggestionSnapshotPlan {
  if (write.kind === 'income') {
    return {
      monthlyIncome: write.monthlyIncome,
      mode: current?.mode ?? BUDGET_MODE_DEFAULT,
      allocations: (current?.allocations ?? []).map((allocation) => ({
        categoryId: allocation.categoryId,
        groupName: allocation.groupName,
        groupOrder: allocation.groupOrder,
        categoryOrder: allocation.categoryOrder,
        percentageOfIncome: percentageOf(
          allocation.targetCents,
          write.monthlyIncome,
        ),
        targetCents: allocation.targetCents,
      })),
    };
  }

  const monthlyIncome = current?.monthlyIncome ?? null;

  return {
    monthlyIncome,
    mode: 'fixed',
    allocations: write.allocations.map((allocation) => ({
      ...allocation,
      percentageOfIncome: percentageOf(allocation.targetCents, monthlyIncome),
    })),
  };
}
