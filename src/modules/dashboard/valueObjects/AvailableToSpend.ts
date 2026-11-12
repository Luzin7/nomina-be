import type { BudgetStatusResponse } from '@modules/budget/features/get-status/get-status.handler';

export type InsightCode =
  | 'OVER_BUDGET'
  | 'CARD_BILL_DUE'
  | 'PROJECTION_SHORTFALL'
  | 'CATEGORY_BREACH'
  | 'UNALLOCATED_INCOME';

export type InsightSeverity = 'high' | 'medium' | 'low';

export type AvailableToSpendInsight = {
  code: InsightCode;
  severity: InsightSeverity;
  args: Record<string, string | number>;
  href: string;
};

export type AvailableToSpendState =
  | 'no-budget'
  | 'within-budget'
  | 'over-budget';

export type AvailableToSpendResponse = {
  month: string;
  daysRemaining: number;
  budget:
    | { exists: false }
    | { exists: true; totalTargetCents: number; totalSpentCents: number };
  remainingBudgetCents: number | null;
  reservations: {
    recurringNotYetGeneratedCents: number;
    goalAportesCents: number;
  };
  spendableCents: number | null;
  perDayCents: number | null;
  state: AvailableToSpendState;
  insight: AvailableToSpendInsight | null;
};

export type SpendableFigureInput = {
  budget: BudgetStatusResponse;
  recurringNotYetGeneratedCents: number;
  goalAportesCents: number;
  daysRemaining: number;
};

export type SpendableFigure = Pick<
  AvailableToSpendResponse,
  | 'budget'
  | 'remainingBudgetCents'
  | 'reservations'
  | 'spendableCents'
  | 'perDayCents'
  | 'state'
>;

const stateOf = (spendableCents: number): AvailableToSpendState =>
  spendableCents < 0 ? 'over-budget' : 'within-budget';

const perDayOf = (spendableCents: number, daysRemaining: number): number =>
  Math.floor(spendableCents / Math.max(daysRemaining, 1));

export function buildSpendableFigure({
  budget,
  recurringNotYetGeneratedCents,
  goalAportesCents,
  daysRemaining,
}: SpendableFigureInput): SpendableFigure {
  const reservations = { recurringNotYetGeneratedCents, goalAportesCents };

  if (!budget.exists) {
    return {
      budget: { exists: false },
      remainingBudgetCents: null,
      reservations,
      spendableCents: null,
      perDayCents: null,
      state: 'no-budget',
    };
  }

  const remainingBudgetCents = budget.totalTargetCents - budget.totalSpent;
  const spendableCents =
    remainingBudgetCents - recurringNotYetGeneratedCents - goalAportesCents;

  return {
    budget: {
      exists: true,
      totalTargetCents: budget.totalTargetCents,
      totalSpentCents: budget.totalSpent,
    },
    remainingBudgetCents,
    reservations,
    spendableCents,
    perDayCents:
      spendableCents > 0 ? perDayOf(spendableCents, daysRemaining) : null,
    state: stateOf(spendableCents),
  };
}
