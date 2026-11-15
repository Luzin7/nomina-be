import type { GoalContributionRecord } from '@modules/goal/repositories/contracts/GoalContributionRepository';

export type GoalContributionPayload = {
  id: string;
  goalId: string;
  amountCents: number;
  sourceAccountId: string | null;
  contributedAt: string;
  createdAt: string;
};

export class GoalContributionPresenter {
  static toHTTP(record: GoalContributionRecord): GoalContributionPayload {
    return {
      id: record.id,
      goalId: record.goalId,
      amountCents: record.amountCents,
      sourceAccountId: record.sourceAccountId,
      contributedAt: record.contributedAt.toISOString(),
      createdAt: record.createdAt.toISOString(),
    };
  }
}
