import { RecurrenceFrequency, TransactionType } from '@constants/enums';
import { DrizzleService } from '@infra/databases/drizzle/drizzle.service';
import {
  BudgetCategoryRef,
  BudgetRepository,
  BudgetSnapshot,
  PresetCategory,
  SavedBudgetSnapshot,
  SaveBudgetSnapshotInput,
} from '@modules/budget/repositories/contracts/BudgetRepository';
import {
  BudgetSnapshotConflictError,
  ForbiddenBudgetCategoryError,
} from '@modules/budget/errors';
import { pickApplicableSnapshot } from '@modules/budget/valueObjects/BudgetSnapshotResolution';
import { Injectable } from '@nestjs/common';
import {
  and,
  asc,
  desc,
  eq,
  gte,
  inArray,
  isNull,
  lte,
  or,
  sql,
  sum,
} from 'drizzle-orm';
import { getErrorDetails } from '@shared/utils/error-details';
import * as schema from '../schema';

const UNIQUE_VIOLATION = '23505';
const FOREIGN_KEY_VIOLATION = '23503';
const BUDGET_CATEGORY_FK =
  /budget_allocations_category_id_(categories_id_fk|fkey)/;

type DrizzleTransaction = Parameters<
  Parameters<DrizzleService['db']['transaction']>[0]
>[0];

@Injectable()
export class BudgetRepositoryImplementation implements BudgetRepository {
  constructor(private readonly drizzle: DrizzleService) {}

  async resolveSnapshot(
    workspaceId: string,
    monthStart: Date,
  ): Promise<BudgetSnapshot | null> {
    const snapshots = await this.drizzle.db
      .select()
      .from(schema.budgets)
      .where(eq(schema.budgets.workspaceId, workspaceId))
      .orderBy(desc(schema.budgets.effectiveFrom));

    const snapshot = pickApplicableSnapshot(snapshots, monthStart);
    if (!snapshot) return null;

    const allocations = await this.drizzle.db
      .select({
        id: schema.budgetAllocations.id,
        categoryId: schema.budgetAllocations.categoryId,
        categoryName: schema.categories.name,
        groupName: schema.budgetAllocations.groupName,
        groupOrder: schema.budgetAllocations.groupOrder,
        categoryOrder: schema.budgetAllocations.categoryOrder,
        percentageOfIncome: schema.budgetAllocations.percentageOfIncome,
        targetCents: schema.budgetAllocations.targetCents,
      })
      .from(schema.budgetAllocations)
      .leftJoin(
        schema.categories,
        eq(schema.budgetAllocations.categoryId, schema.categories.id),
      )
      .where(eq(schema.budgetAllocations.budgetId, snapshot.id))
      .orderBy(
        asc(schema.budgetAllocations.groupOrder),
        asc(schema.budgetAllocations.categoryOrder),
      );

    return {
      id: snapshot.id,
      workspaceId: snapshot.workspaceId,
      effectiveFrom: snapshot.effectiveFrom,
      monthlyIncome: snapshot.monthlyIncome,
      allocations,
    };
  }

  async findCategoriesByIds(
    categoryIds: string[],
  ): Promise<BudgetCategoryRef[]> {
    if (categoryIds.length === 0) return [];

    return this.drizzle.db
      .select({
        id: schema.categories.id,
        name: schema.categories.name,
        workspaceId: schema.categories.workspaceId,
      })
      .from(schema.categories)
      .where(inArray(schema.categories.id, categoryIds));
  }

  async findCompletedExpenseByCategory(
    workspaceId: string,
    start: Date,
    end: Date,
  ): Promise<Record<string, number>> {
    const rows = await this.drizzle.db
      .select({
        categoryId: schema.transactions.categoryId,
        total: sum(schema.transactions.amount).mapWith(Number),
      })
      .from(schema.transactions)
      .where(
        and(
          eq(schema.transactions.workspaceId, workspaceId),
          eq(schema.transactions.type, TransactionType.EXPENSE),
          eq(schema.transactions.status, 'COMPLETED'),
          gte(schema.transactions.date, start),
          lte(schema.transactions.date, end),
        ),
      )
      .groupBy(schema.transactions.categoryId);

    return Object.fromEntries(rows.map((row) => [row.categoryId, row.total]));
  }

  async findCategoryParentMap(
    workspaceId: string,
  ): Promise<Record<string, string | null>> {
    const rows = await this.drizzle.db
      .select({
        id: schema.categories.id,
        parentId: schema.categories.parentId,
      })
      .from(schema.categories)
      .where(
        or(
          eq(schema.categories.workspaceId, workspaceId),
          isNull(schema.categories.workspaceId),
        ),
      );

    return Object.fromEntries(rows.map((row) => [row.id, row.parentId]));
  }

  async saveSnapshot(
    input: SaveBudgetSnapshotInput,
  ): Promise<SavedBudgetSnapshot> {
    try {
      return await this.drizzle.db.transaction(async (tx) => {
        await tx.execute(
          sql`SELECT pg_advisory_xact_lock(hashtext(${input.workspaceId}))`,
        );

        const [existing] = await tx
          .select({ id: schema.budgets.id })
          .from(schema.budgets)
          .where(
            and(
              eq(schema.budgets.workspaceId, input.workspaceId),
              eq(schema.budgets.effectiveFrom, input.effectiveFrom),
            ),
          )
          .for('update');

        await assertCategoriesBelongToWorkspace(tx, input);

        const [saved] = existing
          ? await tx
              .update(schema.budgets)
              .set({ monthlyIncome: input.monthlyIncome })
              .where(eq(schema.budgets.id, existing.id))
              .returning({
                id: schema.budgets.id,
                effectiveFrom: schema.budgets.effectiveFrom,
              })
          : await tx
              .insert(schema.budgets)
              .values({
                workspaceId: input.workspaceId,
                effectiveFrom: input.effectiveFrom,
                monthlyIncome: input.monthlyIncome,
              })
              .returning({
                id: schema.budgets.id,
                effectiveFrom: schema.budgets.effectiveFrom,
              });

        await tx
          .delete(schema.budgetAllocations)
          .where(eq(schema.budgetAllocations.budgetId, saved.id));

        if (input.allocations.length > 0) {
          await tx.insert(schema.budgetAllocations).values(
            input.allocations.map((allocation) => ({
              budgetId: saved.id,
              categoryId: allocation.categoryId,
              groupName: allocation.groupName,
              groupOrder: allocation.groupOrder,
              categoryOrder: allocation.categoryOrder,
              percentageOfIncome: allocation.percentageOfIncome,
              targetCents: allocation.targetCents,
            })),
          );
        }

        return saved;
      });
    } catch (error) {
      const details = getErrorDetails(error);

      if (details.sqlState === UNIQUE_VIOLATION) {
        throw new BudgetSnapshotConflictError();
      }

      if (
        details.sqlState === FOREIGN_KEY_VIOLATION &&
        BUDGET_CATEGORY_FK.test(details.messageChain)
      ) {
        throw new ForbiddenBudgetCategoryError();
      }

      throw error;
    }
  }

  async findMonthlyIncomeSuggestion(workspaceId: string): Promise<number> {
    const [row] = await this.drizzle.db
      .select({
        total: sum(schema.recurringTransactions.amount).mapWith(Number),
      })
      .from(schema.recurringTransactions)
      .where(
        and(
          eq(schema.recurringTransactions.workspaceId, workspaceId),
          eq(schema.recurringTransactions.type, TransactionType.INCOME),
          eq(schema.recurringTransactions.active, true),
          eq(
            schema.recurringTransactions.frequency,
            RecurrenceFrequency.MONTHLY,
          ),
        ),
      );

    return row?.total ?? 0;
  }

  async findPresetCategories(workspaceId: string): Promise<PresetCategory[]> {
    return this.drizzle.db
      .select({ id: schema.categories.id, name: schema.categories.name })
      .from(schema.categories)
      .where(
        and(
          eq(schema.categories.workspaceId, workspaceId),
          eq(schema.categories.type, TransactionType.EXPENSE),
          sql`${schema.categories.parentId} IS NULL`,
        ),
      )
      .orderBy(asc(schema.categories.name));
  }
}

async function assertCategoriesBelongToWorkspace(
  tx: DrizzleTransaction,
  input: SaveBudgetSnapshotInput,
): Promise<void> {
  const categoryIds = [...new Set(input.allocations.map((a) => a.categoryId))];
  if (categoryIds.length === 0) return;

  const found = await tx
    .select({ id: schema.categories.id })
    .from(schema.categories)
    .where(
      and(
        inArray(schema.categories.id, categoryIds),
        or(
          isNull(schema.categories.workspaceId),
          eq(schema.categories.workspaceId, input.workspaceId),
        ),
      ),
    );

  if (found.length !== categoryIds.length) {
    throw new ForbiddenBudgetCategoryError();
  }
}
