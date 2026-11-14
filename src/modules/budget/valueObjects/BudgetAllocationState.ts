export type BudgetAllocationState = 'under' | 'balanced' | 'over';

export function resolveAllocationState(
  monthlyIncomeCents: number | null,
  totalTargetCents: number,
): BudgetAllocationState {
  if (monthlyIncomeCents === null) return 'balanced';
  if (totalTargetCents === monthlyIncomeCents) return 'balanced';

  return totalTargetCents < monthlyIncomeCents ? 'under' : 'over';
}
