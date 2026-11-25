import { type BudgetMode } from '@constants/enums';
import {
  resolveAllocationState,
  type BudgetAllocationState,
} from '@modules/budget/valueObjects/BudgetAllocationState';

export type BudgetConfigResponse = {
  id: string;
  effectiveFrom: Date;
  mode: BudgetMode;
  monthlyIncomeCents: number;
  totalTargetCents: number;
  unallocatedIncomeCents: number;
  allocationState: BudgetAllocationState;
};

type BuildBudgetConfigResponseInput = {
  saved: { id: string; effectiveFrom: Date };
  mode: BudgetMode;
  monthlyIncomeCents: number;
  targetCents: number[];
};

export const buildBudgetConfigResponse = ({
  saved,
  mode,
  monthlyIncomeCents,
  targetCents,
}: BuildBudgetConfigResponseInput): BudgetConfigResponse => {
  const totalTargetCents = targetCents.reduce(
    (total, value) => total + value,
    0,
  );

  return {
    id: saved.id,
    effectiveFrom: saved.effectiveFrom,
    mode,
    monthlyIncomeCents,
    totalTargetCents,
    unallocatedIncomeCents: Math.max(0, monthlyIncomeCents - totalTargetCents),
    allocationState: resolveAllocationState(
      monthlyIncomeCents,
      totalTargetCents,
    ),
  };
};
