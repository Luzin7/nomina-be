export type GoalRecord = {
  id: string;
  workspaceId: string;
  name: string;
  targetCents: number;
  currentCents: number;
  monthlyAporteCents: number;
  linkedAccountId: string | null;
  categoryId: string | null;
  isEmergency: boolean;
  isSystem: boolean;
  dismissedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export type CreateGoalInput = {
  workspaceId: string;
  name: string;
  targetCents: number;
  currentCents?: number;
  monthlyAporteCents?: number;
  linkedAccountId?: string | null;
  categoryId?: string | null;
};

export type UpdateGoalInput = {
  name?: string;
  targetCents?: number;
  currentCents?: number;
  monthlyAporteCents?: number;
  linkedAccountId?: string | null;
  categoryId?: string | null;
  dismissedAt?: Date | null;
};

export type GoalsSummaryAggregates = {
  totalTargetCents: number;
  totalCurrentCents: number;
  activeCount: number;
  completedCount: number;
  unsetTargetCount: number;
};

export abstract class GoalRepository {
  abstract listByWorkspace(workspaceId: string): Promise<GoalRecord[]>;

  abstract create(input: CreateGoalInput): Promise<GoalRecord>;

  abstract findById(
    id: string,
    workspaceId: string,
  ): Promise<GoalRecord | null>;

  abstract findByIdForUpdate(
    id: string,
    workspaceId: string,
    mutate: (current: GoalRecord) => UpdateGoalInput,
  ): Promise<GoalRecord | null>;

  abstract delete(id: string, workspaceId: string): Promise<boolean>;

  abstract seedEmergencyGoal(workspaceId: string): Promise<void>;

  abstract sumMonthlyAporteCents(workspaceId: string): Promise<number>;

  abstract getSummaryAggregates(
    workspaceId: string,
  ): Promise<GoalsSummaryAggregates>;
}
