import type { GoalsSummary } from '@modules/goal/valueObjects/GoalsSummary';

export type GoalsSummaryPresenterPayload = {
  monthlyAporteCents: number;
  totalTargetCents: number;
  totalCurrentCents: number;
  activeCount: number;
  completedCount: number;
  unsetTargetCount: number;
};

export class GoalsSummaryPresenter {
  static toHTTP(summary: GoalsSummary): GoalsSummaryPresenterPayload {
    return {
      monthlyAporteCents: summary.monthlyAporteCents,
      totalTargetCents: summary.totalTargetCents,
      totalCurrentCents: summary.totalCurrentCents,
      activeCount: summary.activeCount,
      completedCount: summary.completedCount,
      unsetTargetCount: summary.unsetTargetCount,
    };
  }
}
