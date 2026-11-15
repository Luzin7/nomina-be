import { GoalRecord } from '@modules/goal/repositories/contracts/GoalRepository';
import * as schema from '../schema';

export function toGoalRecord(
  row: typeof schema.goals.$inferSelect,
  linkedAccountBalanceCents: number | null = null,
): GoalRecord {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    name: row.name,
    targetCents: row.targetCents,
    currentCents: row.currentCents,
    monthlyAporteCents: row.monthlyAporteCents,
    linkedAccountId: row.linkedAccountId,
    progressSource: row.progressSource,
    linkedAccountBalanceCents,
    categoryId: row.categoryId,
    isEmergency: row.isEmergency,
    isSystem: row.isSystem,
    dismissedAt: row.dismissedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
