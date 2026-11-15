import { DrizzleService } from '@infra/databases/drizzle/drizzle.service';
import {
  GoalCategoryInvalidError,
  GoalLinkedAccountInvalidError,
} from '@modules/goal/errors';
import {
  CreateGoalInput,
  GoalRecord,
  GoalRepository,
  GoalsSummaryAggregates,
  UpdateGoalInput,
} from '@modules/goal/repositories/contracts/GoalRepository';
import { Injectable } from '@nestjs/common';
import { and, asc, desc, eq, gt, isNull, lt, sql } from 'drizzle-orm';
import { getErrorDetails } from '@shared/utils/error-details';
import * as schema from '../schema';
import { insertEmergencyGoal } from './emergency-goal';

const FOREIGN_KEY_VIOLATION = '23503';
const GOAL_LINKED_ACCOUNT_FK = /goals_linked_account_id_(accounts_id_fk|fkey)/;
const GOAL_CATEGORY_FK = /goals_category_id_(categories_id_fk|fkey)/;

@Injectable()
export class GoalRepositoryImplementation implements GoalRepository {
  constructor(private readonly drizzle: DrizzleService) {}

  async listByWorkspace(workspaceId: string): Promise<GoalRecord[]> {
    const rows = await this.drizzle.db
      .select()
      .from(schema.goals)
      .where(eq(schema.goals.workspaceId, workspaceId))
      .orderBy(desc(schema.goals.isEmergency), asc(schema.goals.createdAt));

    return rows.map(toGoalRecord);
  }

  async create(input: CreateGoalInput): Promise<GoalRecord> {
    return this.writeChecked(async () => {
      const [row] = await this.drizzle.db
        .insert(schema.goals)
        .values({
          workspaceId: input.workspaceId,
          name: input.name,
          targetCents: input.targetCents,
          currentCents: input.currentCents ?? 0,
          monthlyAporteCents: input.monthlyAporteCents ?? 0,
          linkedAccountId: input.linkedAccountId ?? null,
          categoryId: input.categoryId ?? null,
        })
        .returning();

      return toGoalRecord(row);
    });
  }

  async findById(id: string, workspaceId: string): Promise<GoalRecord | null> {
    const [row] = await this.drizzle.db
      .select()
      .from(schema.goals)
      .where(
        and(eq(schema.goals.id, id), eq(schema.goals.workspaceId, workspaceId)),
      )
      .limit(1);

    return row ? toGoalRecord(row) : null;
  }

  async findByIdForUpdate(
    id: string,
    workspaceId: string,
    mutate: (current: GoalRecord) => UpdateGoalInput,
  ): Promise<GoalRecord | null> {
    return this.writeChecked(() =>
      this.drizzle.db.transaction(async (tx) => {
        await tx.execute(sql`set local lock_timeout = '3s'`);
        const [current] = await tx
          .select()
          .from(schema.goals)
          .where(
            and(
              eq(schema.goals.id, id),
              eq(schema.goals.workspaceId, workspaceId),
            ),
          )
          .limit(1)
          .for('update');

        if (!current) return null;

        const [updated] = await tx
          .update(schema.goals)
          .set(toUpdateValues(mutate(toGoalRecord(current))))
          .where(eq(schema.goals.id, id))
          .returning();

        return toGoalRecord(updated);
      }),
    );
  }

  async delete(id: string, workspaceId: string): Promise<boolean> {
    const deleted = await this.drizzle.db
      .delete(schema.goals)
      .where(
        and(eq(schema.goals.id, id), eq(schema.goals.workspaceId, workspaceId)),
      )
      .returning({ id: schema.goals.id });

    return deleted.length > 0;
  }

  async seedEmergencyGoal(workspaceId: string): Promise<void> {
    await insertEmergencyGoal(this.drizzle.db, workspaceId);
  }

  async sumMonthlyAporteCents(workspaceId: string): Promise<number> {
    const [row] = await this.drizzle.db
      .select({
        total:
          sql<number>`COALESCE(SUM(${schema.goals.monthlyAporteCents}), 0)`.mapWith(
            Number,
          ),
      })
      .from(schema.goals)
      .where(
        and(
          eq(schema.goals.workspaceId, workspaceId),
          gt(schema.goals.monthlyAporteCents, 0),
          gt(schema.goals.targetCents, 0),
          isNull(schema.goals.dismissedAt),
          lt(schema.goals.currentCents, schema.goals.targetCents),
        ),
      );

    return row.total;
  }

  async getSummaryAggregates(
    workspaceId: string,
  ): Promise<GoalsSummaryAggregates> {
    const [row] = await this.drizzle.db
      .select({
        totalTargetCents:
          sql<number>`COALESCE(SUM(${schema.goals.targetCents}), 0)`.mapWith(
            Number,
          ),
        totalCurrentCents:
          sql<number>`COALESCE(SUM(${schema.goals.currentCents}), 0)`.mapWith(
            Number,
          ),
        activeCount:
          sql<number>`COUNT(*) FILTER (WHERE ${schema.goals.targetCents} > 0 AND ${schema.goals.currentCents} < ${schema.goals.targetCents})`.mapWith(
            Number,
          ),
        completedCount:
          sql<number>`COUNT(*) FILTER (WHERE ${schema.goals.targetCents} > 0 AND ${schema.goals.currentCents} >= ${schema.goals.targetCents})`.mapWith(
            Number,
          ),
        unsetTargetCount:
          sql<number>`COUNT(*) FILTER (WHERE ${schema.goals.targetCents} = 0)`.mapWith(
            Number,
          ),
      })
      .from(schema.goals)
      .where(eq(schema.goals.workspaceId, workspaceId));

    return row;
  }

  private async writeChecked<T>(write: () => Promise<T>): Promise<T> {
    try {
      return await write();
    } catch (error) {
      const details = getErrorDetails(error);

      if (details.sqlState === FOREIGN_KEY_VIOLATION) {
        if (GOAL_LINKED_ACCOUNT_FK.test(details.messageChain)) {
          throw new GoalLinkedAccountInvalidError();
        }

        if (GOAL_CATEGORY_FK.test(details.messageChain)) {
          throw new GoalCategoryInvalidError();
        }
      }

      throw error;
    }
  }
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

function toUpdateValues(
  input: UpdateGoalInput,
): Partial<typeof schema.goals.$inferInsert> {
  return { ...input, updatedAt: new Date() };
}
