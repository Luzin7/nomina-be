import type { GoalRecord } from './GoalRepository';

export type GoalContributionRecord = {
  id: string;
  workspaceId: string;
  goalId: string;
  amountCents: number;
  sourceAccountId: string | null;
  contributedAt: Date;
  createdAt: Date;
};

export type RecordContributionInput = {
  id: string;
  workspaceId: string;
  goalId: string;
  amountCents: number;
  sourceAccountId: string | null;
};

export type UndoContributionInput = {
  id: string;
  goalId: string;
  workspaceId: string;
};

export type RecordContributionResult =
  | {
      status: 'recorded' | 'replayed';
      contribution: GoalContributionRecord;
      goal: GoalRecord;
    }
  | { status: 'id-conflict' }
  | { status: 'goal-not-found' }
  | { status: 'source-account-invalid' };

export type UndoContributionResult = {
  status:
    | 'undone'
    | 'goal-not-found'
    | 'contribution-not-found'
    | 'undo-conflict';
};

export abstract class GoalContributionRepository {
  abstract recordContribution(
    input: RecordContributionInput,
  ): Promise<RecordContributionResult>;

  abstract undoContribution(
    input: UndoContributionInput,
  ): Promise<UndoContributionResult>;

  abstract listContributionsByGoal(
    goalId: string,
    workspaceId: string,
  ): Promise<GoalContributionRecord[]>;
}
