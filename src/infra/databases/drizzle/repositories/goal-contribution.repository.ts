import { DrizzleService } from '@infra/databases/drizzle/drizzle.service';
import {
  GoalContributionRecord,
  GoalContributionRepository,
  RecordContributionInput,
  RecordContributionResult,
  UndoContributionInput,
  UndoContributionResult,
} from '@modules/goal/repositories/contracts/GoalContributionRepository';
import { GoalRecord } from '@modules/goal/repositories/contracts/GoalRepository';
import { Injectable } from '@nestjs/common';
import { TransactionRollbackError, and, desc, eq, sql } from 'drizzle-orm';
import * as schema from '../schema';

type Tx = Parameters<Parameters<DrizzleService['db']['transaction']>[0]>[0];

@Injectable()
export class GoalContributionRepositoryImplementation implements GoalContributionRepository {
  constructor(private readonly drizzle: DrizzleService) {}

  async recordContribution(
    input: RecordContributionInput,
  ): Promise<RecordContributionResult> {
    return this.drizzle.db.transaction(async (tx) => {
      const locked = await lockGoal(tx, input.goalId, input.workspaceId);
      if (!locked) return { status: 'goal-not-found' };

      const [inserted] = await tx
        .insert(schema.goalContributions)
        .values(input)
        .onConflictDoNothing({ target: schema.goalContributions.id })
        .returning();

      if (!inserted) return this.resolveReplay(tx, input, locked);

      const [goal] = await tx
        .update(schema.goals)
        .set({
          currentCents: sql`${schema.goals.currentCents} + ${input.amountCents}`,
          updatedAt: new Date(),
        })
        .where(eq(schema.goals.id, input.goalId))
        .returning();

      return {
        status: 'recorded',
        contribution: toContributionRecord(inserted),
        goal: toGoalRecord(goal),
      };
    });
  }

  async undoContribution({
    id,
    goalId,
    workspaceId,
  }: UndoContributionInput): Promise<UndoContributionResult> {
    try {
      return await this.undoInTransaction({ id, goalId, workspaceId });
    } catch (error) {
      if (error instanceof TransactionRollbackError) {
        return { status: 'undo-conflict' };
      }

      throw error;
    }
  }

  private undoInTransaction({
    id,
    goalId,
    workspaceId,
  }: UndoContributionInput): Promise<UndoContributionResult> {
    return this.drizzle.db.transaction(async (tx) => {
      const locked = await lockGoal(tx, goalId, workspaceId);
      if (!locked) return { status: 'goal-not-found' };

      const [removed] = await tx
        .delete(schema.goalContributions)
        .where(
          and(
            eq(schema.goalContributions.id, id),
            eq(schema.goalContributions.goalId, goalId),
            eq(schema.goalContributions.workspaceId, workspaceId),
          ),
        )
        .returning({ amountCents: schema.goalContributions.amountCents });

      if (!removed) return { status: 'contribution-not-found' };

      if (locked.currentCents - removed.amountCents < 0) {
        return tx.rollback();
      }

      await tx
        .update(schema.goals)
        .set({
          currentCents: sql`${schema.goals.currentCents} - ${removed.amountCents}`,
          updatedAt: new Date(),
        })
        .where(eq(schema.goals.id, goalId));

      return { status: 'undone' };
    });
  }

  async listContributionsByGoal(
    goalId: string,
    workspaceId: string,
  ): Promise<GoalContributionRecord[]> {
    const rows = await this.drizzle.db
      .select()
      .from(schema.goalContributions)
      .where(
        and(
          eq(schema.goalContributions.goalId, goalId),
          eq(schema.goalContributions.workspaceId, workspaceId),
        ),
      )
      .orderBy(
        desc(schema.goalContributions.contributedAt),
        desc(schema.goalContributions.createdAt),
      );

    return rows.map(toContributionRecord);
  }

  private async resolveReplay(
    tx: Tx,
    input: RecordContributionInput,
    goal: GoalRecord,
  ): Promise<RecordContributionResult> {
    const [existing] = await tx
      .select()
      .from(schema.goalContributions)
      .where(eq(schema.goalContributions.id, input.id))
      .limit(1);

    if (
      !existing ||
      existing.goalId !== input.goalId ||
      existing.workspaceId !== input.workspaceId
    ) {
      return { status: 'id-conflict' };
    }

    return {
      status: 'replayed',
      contribution: toContributionRecord(existing),
      goal,
    };
  }
}

async function lockGoal(
  tx: Tx,
  goalId: string,
  workspaceId: string,
): Promise<GoalRecord | null> {
  const [row] = await tx
    .select()
    .from(schema.goals)
    .where(
      and(
        eq(schema.goals.id, goalId),
        eq(schema.goals.workspaceId, workspaceId),
      ),
    )
    .limit(1)
    .for('update');

  return row ? toGoalRecord(row) : null;
}

function toContributionRecord(
  row: typeof schema.goalContributions.$inferSelect,
): GoalContributionRecord {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    goalId: row.goalId,
    amountCents: row.amountCents,
    sourceAccountId: row.sourceAccountId,
    contributedAt: row.contributedAt,
    createdAt: row.createdAt,
  };
}

function toGoalRecord(row: typeof schema.goals.$inferSelect): GoalRecord {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    name: row.name,
    targetCents: row.targetCents,
    currentCents: row.currentCents,
    monthlyAporteCents: row.monthlyAporteCents,
    linkedAccountId: row.linkedAccountId,
    categoryId: row.categoryId,
    isEmergency: row.isEmergency,
    isSystem: row.isSystem,
    dismissedAt: row.dismissedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
