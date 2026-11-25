import { BUDGET_MODE_DEFAULT, type BudgetMode } from '@constants/enums';
import type {
  BudgetSnapshot,
  SaveBudgetAllocationInput,
  SuggestedAllocationInput,
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

const planOfTargets = (
  monthlyIncome: number | null,
  mode: BudgetMode,
  allocations: SuggestedAllocationInput[],
): SuggestionSnapshotPlan => ({
  monthlyIncome,
  mode,
  allocations: allocations.map((allocation) => ({
    ...allocation,
    percentageOfIncome: percentageOf(allocation.targetCents, monthlyIncome),
  })),
});

const modeOfMonth = (
  snapshot: BudgetSnapshot | null,
  monthStart: Date,
): BudgetMode =>
  snapshot !== null && snapshot.effectiveFrom.getTime() === monthStart.getTime()
    ? snapshot.mode
    : 'fixed';

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

  return planOfTargets(
    current?.monthlyIncome ?? null,
    'fixed',
    write.allocations,
  );
}

export function planResetSnapshot(
  current: BudgetSnapshot | null,
  monthStart: Date,
  allocations: SuggestedAllocationInput[],
): SuggestionSnapshotPlan {
  return planOfTargets(
    current?.monthlyIncome ?? null,
    modeOfMonth(current, monthStart),
    allocations,
  );
}
