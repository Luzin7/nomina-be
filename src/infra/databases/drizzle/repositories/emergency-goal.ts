import { DrizzleService } from '@infra/databases/drizzle/drizzle.service';
import { EMERGENCY_GOAL_NAME } from '@modules/goal/constants/goal';
import { sql } from 'drizzle-orm';
import * as schema from '../schema';

type GoalWriteClient = Pick<DrizzleService['db'], 'insert'>;

export async function insertEmergencyGoal(
  client: GoalWriteClient,
  workspaceId: string,
): Promise<void> {
  await client
    .insert(schema.goals)
    .values({
      workspaceId,
      name: EMERGENCY_GOAL_NAME,
      targetCents: 0,
      currentCents: 0,
      monthlyAporteCents: 0,
      isEmergency: true,
      isSystem: true,
    })
    .onConflictDoNothing({
      target: schema.goals.workspaceId,
      where: sql`${schema.goals.isEmergency}`,
    });
}
