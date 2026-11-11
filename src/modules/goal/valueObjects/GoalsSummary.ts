import type { GoalsSummaryAggregates } from '@modules/goal/repositories/contracts/GoalRepository';

export type GoalsSummary = {
  monthlyAporteCents: number;
  totalTargetCents: number;
  totalCurrentCents: number;
  activeCount: number;
  completedCount: number;
  unsetTargetCount: number;
};

export function buildGoalsSummary(
  monthlyAporteCents: number,
  aggregates: GoalsSummaryAggregates,
): GoalsSummary {
  return {
    monthlyAporteCents,
    totalTargetCents: aggregates.totalTargetCents,
    totalCurrentCents: aggregates.totalCurrentCents,
    activeCount: aggregates.activeCount,
    completedCount: aggregates.completedCount,
    unsetTargetCount: aggregates.unsetTargetCount,
  };
}
