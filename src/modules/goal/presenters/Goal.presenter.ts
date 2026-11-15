import type { Goal } from '@modules/goal/entities/Goal';
import { localMonthKey } from '@utils/localMonth';

const MONTHS_PER_YEAR = 12;

export type GoalPresenterContext = {
  now: Date;
  timezone: string;
};

export type GoalPresenterPayload = {
  id: string;
  name: string;
  targetCents: number;
  configured: boolean;
  currentCents: number;
  monthlyAporteCents: number;
  linkedAccountId: string | null;
  categoryId: string | null;
  isEmergency: boolean;
  isSystem: boolean;
  dismissedAt: string | null;
  remainingCents: number | null;
  progressPercent: number | null;
  reached: boolean;
  etaMonths: number | null;
  etaMonth: string | null;
};

export class GoalPresenter {
  static toHTTP(
    goal: Goal,
    { now, timezone }: GoalPresenterContext,
  ): GoalPresenterPayload {
    const record = goal.record;
    const etaMonths = goal.etaMonths;

    return {
      id: record.id,
      name: record.name,
      targetCents: record.targetCents,
      configured: goal.configured,
      currentCents: record.currentCents,
      monthlyAporteCents: record.monthlyAporteCents,
      linkedAccountId: record.linkedAccountId,
      categoryId: record.categoryId,
      isEmergency: record.isEmergency,
      isSystem: record.isSystem,
      dismissedAt:
        record.dismissedAt === null ? null : record.dismissedAt.toISOString(),
      remainingCents: goal.remainingCents,
      progressPercent: goal.progressPercent,
      reached: goal.reached,
      etaMonths,
      etaMonth:
        etaMonths === null ? null : resolveEtaMonth(etaMonths, now, timezone),
    };
  }
}

function resolveEtaMonth(
  etaMonths: number,
  now: Date,
  timezone: string,
): string {
  const [year, month] = localMonthKey(now, timezone).split('-').map(Number);
  const totalMonths = year * MONTHS_PER_YEAR + (month - 1) + etaMonths;
  const targetYear = Math.floor(totalMonths / MONTHS_PER_YEAR);
  const targetMonth = (totalMonths % MONTHS_PER_YEAR) + 1;

  return `${targetYear}-${String(targetMonth).padStart(2, '0')}`;
}
