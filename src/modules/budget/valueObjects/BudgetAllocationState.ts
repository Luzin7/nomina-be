export type BudgetAllocationState = 'under' | 'balanced' | 'over';

export function resolveAllocationState(
  monthlyIncomeCents: number,
  totalTargetCents: number,
): BudgetAllocationState {
  if (totalTargetCents === monthlyIncomeCents) return 'balanced';

  return totalTargetCents < monthlyIncomeCents ? 'under' : 'over';
}
