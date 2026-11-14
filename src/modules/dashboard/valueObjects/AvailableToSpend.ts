import type { BudgetStatusResponse } from '@modules/budget/features/get-status/get-status.handler';
import type { ResolvedMonthPlan } from '@modules/report/services/resolve-month-plan.service';
import type { ProvisionalBasis } from '@modules/report/valueObjects/ProvisionalPlan';

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

export type AvailableToSpendBudget =
  | { exists: false; recurringDueCents: number; totalSpentCents: number }
  | {
      exists: true;
      source: 'declared';
      provisional: false;
      totalTargetCents: number;
      totalSpentCents: number;
    }
  | {
      exists: true;
      source: 'provisional';
      provisional: true;
      totalTargetCents: number;
      totalSpentCents: number;
      basis: ProvisionalBasis;
    };

export type AvailableToSpendResponse = {
  month: string;
  daysRemaining: number;
  budget: AvailableToSpendBudget;
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
  plan: ResolvedMonthPlan;
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

type FigureBudget = Extract<AvailableToSpendBudget, { exists: true }>;

const figureBudgetOf = (
  budget: BudgetStatusResponse,
  plan: ResolvedMonthPlan,
): FigureBudget | null => {
  if (plan.source === 'provisional') {
    return {
      exists: true,
      source: 'provisional',
      provisional: true,
      totalTargetCents: plan.planTotalCents,
      totalSpentCents: plan.spentCents,
      basis: plan.basis,
    };
  }

  if (plan.source !== 'declared' || !budget.exists) return null;

  return {
    exists: true,
    source: 'declared',
    provisional: false,
    totalTargetCents: budget.totalTargetCents,
    totalSpentCents: budget.totalSpent,
  };
};

const spentOf = (
  budget: BudgetStatusResponse,
  plan: ResolvedMonthPlan,
): number => {
  if (plan.source === 'nothing-observed') return plan.spentCents;
  return budget.exists ? budget.totalSpent : 0;
};

export function buildSpendableFigure({
  budget,
  plan,
  recurringNotYetGeneratedCents,
  goalAportesCents,
  daysRemaining,
}: SpendableFigureInput): SpendableFigure {
  const reservations = { recurringNotYetGeneratedCents, goalAportesCents };
  const figureBudget = figureBudgetOf(budget, plan);

  if (!figureBudget) {
    return {
      budget: {
        exists: false,
        recurringDueCents: recurringNotYetGeneratedCents,
        totalSpentCents: spentOf(budget, plan),
      },
      remainingBudgetCents: null,
      reservations,
      spendableCents: null,
      perDayCents: null,
      state: 'no-budget',
    };
  }

  const remainingBudgetCents =
    figureBudget.totalTargetCents - figureBudget.totalSpentCents;
  const spendableCents =
    remainingBudgetCents - recurringNotYetGeneratedCents - goalAportesCents;

  return {
    budget: figureBudget,
    remainingBudgetCents,
    reservations,
    spendableCents,
    perDayCents:
      spendableCents > 0 ? perDayOf(spendableCents, daysRemaining) : null,
    state: stateOf(spendableCents),
  };
}
