import { DrizzleService } from '@infra/databases/drizzle/drizzle.service';
import { GoalProgressSource } from '@constants/enums';
import {
  GoalCategoryInvalidError,
  GoalLinkedAccountInvalidError,
  LinkedAccountAlreadyTrackedError,
} from '@modules/goal/errors';
import {
  CreateGoalInput,
  GoalRecord,
  GoalRepository,
  GoalsSummaryAggregates,
  UpdateGoalInput,
} from '@modules/goal/repositories/contracts/GoalRepository';
import { Injectable } from '@nestjs/common';
import { and, asc, desc, eq, isNull, sql } from 'drizzle-orm';
import { getErrorDetails } from '@shared/utils/error-details';
import * as schema from '../schema';
import { insertEmergencyGoal } from './emergency-goal';
import { toGoalRecord } from './goal-record.mapper';

const FOREIGN_KEY_VIOLATION = '23503';
const UNIQUE_VIOLATION = '23505';
const GOAL_ACCOUNT_SOURCE_INDEX = /unq_goal_account_source/;

const DERIVED_CURRENT_CENTS = sql`CASE WHEN ${schema.goals.progressSource} = 'account' AND ${schema.accounts.id} IS NOT NULL THEN GREATEST(${schema.accounts.balance}, 0) ELSE ${schema.goals.currentCents} END`;
const GOAL_LINKED_ACCOUNT_FK = /goals_linked_account_id_(accounts_id_fk|fkey)/;
const GOAL_CATEGORY_FK = /goals_category_id_(categories_id_fk|fkey)/;

@Injectable()
export class GoalRepositoryImplementation implements GoalRepository {
  constructor(private readonly drizzle: DrizzleService) {}

  async listByWorkspace(workspaceId: string): Promise<GoalRecord[]> {
    const rows = await this.drizzle.db
      .select({ goal: schema.goals, balance: schema.accounts.balance })
      .from(schema.goals)
      .leftJoin(
        schema.accounts,
        eq(schema.accounts.id, schema.goals.linkedAccountId),
      )
      .where(eq(schema.goals.workspaceId, workspaceId))
      .orderBy(desc(schema.goals.isEmergency), asc(schema.goals.createdAt));

    return rows.map(({ goal, balance }) => toGoalRecord(goal, balance));
  }

  async create(input: CreateGoalInput): Promise<GoalRecord> {
    return this.writeChecked(() =>
      this.drizzle.db.transaction(async (tx) => {
        const [row] = await tx
          .insert(schema.goals)
          .values({
            workspaceId: input.workspaceId,
            name: input.name,
            targetCents: input.targetCents,
            currentCents: input.currentCents ?? 0,
            monthlyAporteCents: input.monthlyAporteCents ?? 0,
            linkedAccountId: input.linkedAccountId ?? null,
            progressSource: input.progressSource ?? GoalProgressSource.MANUAL,
            categoryId: input.categoryId ?? null,
          })
          .returning();

        return toGoalRecord(row, await readBalance(tx, row));
      }),
    );
  }

  async findById(id: string, workspaceId: string): Promise<GoalRecord | null> {
    const [row] = await this.drizzle.db
      .select({ goal: schema.goals, balance: schema.accounts.balance })
      .from(schema.goals)
      .leftJoin(
        schema.accounts,
        eq(schema.accounts.id, schema.goals.linkedAccountId),
      )
      .where(
        and(eq(schema.goals.id, id), eq(schema.goals.workspaceId, workspaceId)),
      )
      .limit(1);

    return row ? toGoalRecord(row.goal, row.balance) : null;
  }

  async findByIdForUpdate(
    id: string,
    workspaceId: string,
    mutate: (current: GoalRecord) => UpdateGoalInput | Error,
  ): Promise<GoalRecord | Error | null> {
    return this.writeChecked(() =>
      this.drizzle.db.transaction(async (tx) => {
        await tx.execute(sql`set local lock_timeout = '3s'`);
        const [current] = await tx
          .select({ goal: schema.goals, balance: schema.accounts.balance })
          .from(schema.goals)
          .leftJoin(
            schema.accounts,
            eq(schema.accounts.id, schema.goals.linkedAccountId),
          )
          .where(
            and(
              eq(schema.goals.id, id),
              eq(schema.goals.workspaceId, workspaceId),
            ),
          )
          .limit(1)
          .for('update', { of: schema.goals });

        if (!current) return null;

        const input = mutate(toGoalRecord(current.goal, current.balance));
        if (input instanceof Error) return input;

        const [updated] = await tx
          .update(schema.goals)
          .set(toUpdateValues(input))
          .where(eq(schema.goals.id, id))
          .returning();

        return toGoalRecord(updated, await readBalance(tx, updated));
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
      .leftJoin(
        schema.accounts,
        eq(schema.accounts.id, schema.goals.linkedAccountId),
      )
      .where(
        and(
          eq(schema.goals.workspaceId, workspaceId),
          sql`${schema.goals.monthlyAporteCents} > 0`,
          sql`${schema.goals.targetCents} > 0`,
          isNull(schema.goals.dismissedAt),
          sql`${DERIVED_CURRENT_CENTS} < ${schema.goals.targetCents}`,
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
          sql<number>`COALESCE(SUM(${DERIVED_CURRENT_CENTS}), 0)`.mapWith(
            Number,
          ),
        activeCount:
          sql<number>`COUNT(*) FILTER (WHERE ${schema.goals.targetCents} > 0 AND ${DERIVED_CURRENT_CENTS} < ${schema.goals.targetCents})`.mapWith(
            Number,
          ),
        completedCount:
          sql<number>`COUNT(*) FILTER (WHERE ${schema.goals.targetCents} > 0 AND ${DERIVED_CURRENT_CENTS} >= ${schema.goals.targetCents})`.mapWith(
            Number,
          ),
        unsetTargetCount:
          sql<number>`COUNT(*) FILTER (WHERE ${schema.goals.targetCents} = 0)`.mapWith(
            Number,
          ),
      })
      .from(schema.goals)
      .leftJoin(
        schema.accounts,
        eq(schema.accounts.id, schema.goals.linkedAccountId),
      )
      .where(eq(schema.goals.workspaceId, workspaceId));

    return row;
  }

  private async writeChecked<T>(write: () => Promise<T>): Promise<T> {
    try {
      return await write();
    } catch (error) {
      const details = getErrorDetails(error);

      if (
        details.sqlState === UNIQUE_VIOLATION &&
        GOAL_ACCOUNT_SOURCE_INDEX.test(details.messageChain)
      ) {
        throw new LinkedAccountAlreadyTrackedError();
      }

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

async function readBalance(
  tx: Parameters<Parameters<DrizzleService['db']['transaction']>[0]>[0],
  goal: typeof schema.goals.$inferSelect,
): Promise<number | null> {
  if (!goal.linkedAccountId) return null;

  const [account] = await tx
    .select({ balance: schema.accounts.balance })
    .from(schema.accounts)
    .where(eq(schema.accounts.id, goal.linkedAccountId));

  return account?.balance ?? null;
}

function toUpdateValues(
  input: UpdateGoalInput,
): Partial<typeof schema.goals.$inferInsert> {
  return { ...input, updatedAt: new Date() };
}
