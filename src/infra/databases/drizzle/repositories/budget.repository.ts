import {
  BUDGET_MODE_DEFAULT,
  type BudgetMode,
  RecurrenceFrequency,
  TransactionType,
} from '@constants/enums';
import { DrizzleService } from '@infra/databases/drizzle/drizzle.service';
import {
  BudgetAllocationRecord,
  BudgetCategoryRef,
  BudgetRepository,
  BudgetSnapshot,
  CompletedExpenseByLocalDayQuery,
  CompletedExpenseOfDay,
  InferenceMonthTotals,
  InferenceTotalsQuery,
  PresetCategory,
  ResolvedBudgetSnapshot,
  SavedBudgetSnapshot,
  SaveBudgetSnapshotInput,
  SaveSnapshotWithDecisionInput,
  SuggestionDecisionInput,
  SuggestionParameters,
  SuggestionWriteOutcome,
} from '@modules/budget/repositories/contracts/BudgetRepository';
import {
  BudgetSnapshotConflictError,
  ForbiddenBudgetCategoryError,
} from '@modules/budget/errors';
import { pickApplicableSnapshot } from '@modules/budget/valueObjects/BudgetSnapshotResolution';
import type { GroupKey } from '@modules/budget/valueObjects/IncomeBracket';
import type { SuggestionCategory } from '@modules/budget/valueObjects/SplitSuggestion';
import type { SuggestionDecisionRecord } from '@modules/budget/valueObjects/SuggestionDecisions';
import { planSuggestionSnapshot } from '@modules/budget/valueObjects/SuggestionSnapshotPlan';
import { SYSTEM_CATEGORY } from '@modules/category/constants/system-categories';
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
  ne,
  not,
  or,
  type SQL,
  sql,
  sum,
} from 'drizzle-orm';
import { getErrorDetails } from '@shared/utils/error-details';
import { localDayIn } from '../sql-helpers';
import * as schema from '../schema';

const INVESTMENTS_CATEGORY_NAME = 'Investimentos';
const MINIMUM_WAGE_KEY = 'minimum_wage';
const MONTH_KEY_LENGTH = 7;
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
    return loadApplicableSnapshot(this.drizzle.db, workspaceId, monthStart);
  }

  async resolveSnapshots(
    workspaceId: string,
    monthStarts: Date[],
  ): Promise<ResolvedBudgetSnapshot[]> {
    if (monthStarts.length === 0) return [];

    const latestMonthStart = monthStarts.reduce(
      (latest, monthStart) =>
        monthStart.getTime() > latest.getTime() ? monthStart : latest,
      monthStarts[0],
    );
    const rows = await this.drizzle.db
      .select({
        effectiveFrom: schema.budgets.effectiveFrom,
        monthlyIncome: schema.budgets.monthlyIncome,
        mode: schema.budgets.mode,
        targetCents: sql<number>`COALESCE((
          SELECT SUM(${schema.budgetAllocations.targetCents})
          FROM ${schema.budgetAllocations}
          WHERE ${schema.budgetAllocations.budgetId} = ${schema.budgets.id}
        ), 0)`.mapWith(Number),
      })
      .from(schema.budgets)
      .where(
        and(
          eq(schema.budgets.workspaceId, workspaceId),
          lte(schema.budgets.effectiveFrom, latestMonthStart),
        ),
      )
      .orderBy(desc(schema.budgets.effectiveFrom));

    return monthStarts.map((monthStart) => {
      const snapshot = pickApplicableSnapshot(rows, monthStart);

      return {
        monthStart,
        snapshot:
          snapshot === null
            ? null
            : {
                monthlyIncomeCents: snapshot.monthlyIncome,
                targetCents: snapshot.targetCents,
                mode: snapshot.mode ?? BUDGET_MODE_DEFAULT,
              },
      };
    });
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
        isHidden: schema.categories.isHidden,
      })
      .from(schema.categories)
      .where(inArray(schema.categories.id, categoryIds));
  }

  private completedExpenseInRange(
    workspaceId: string,
    start: Date,
    end: Date,
  ): SQL | undefined {
    return and(
      eq(schema.transactions.workspaceId, workspaceId),
      eq(schema.transactions.type, TransactionType.EXPENSE),
      eq(schema.transactions.status, 'COMPLETED'),
      gte(schema.transactions.date, start),
      lte(schema.transactions.date, end),
    );
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
      .where(this.completedExpenseInRange(workspaceId, start, end))
      .groupBy(schema.transactions.categoryId);

    return Object.fromEntries(rows.map((row) => [row.categoryId, row.total]));
  }

  async findCompletedExpenseByLocalDay({
    workspaceId,
    start,
    end,
    timezone,
  }: CompletedExpenseByLocalDayQuery): Promise<CompletedExpenseOfDay[]> {
    const localDay = localDayIn(
      sql`(${schema.transactions.date}::timestamp AT TIME ZONE 'UTC')`,
      sql`${timezone}`,
    );
    const dayOfMonth = sql<number>`EXTRACT(DAY FROM ${localDay})::int`;

    const rows = await this.drizzle.db
      .select({
        day: dayOfMonth,
        totalCents: sum(schema.transactions.amount).mapWith(Number),
      })
      .from(schema.transactions)
      .where(this.completedExpenseInRange(workspaceId, start, end))
      .groupBy(sql`1`)
      .orderBy(sql`1`);

    return rows;
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
        await lockWorkspaceBudget(tx, input.workspaceId);

        return writeSnapshot(tx, input);
      });
    } catch (error) {
      return rethrowSnapshotWriteError(error);
    }
  }

  async findInferenceTotals({
    workspaceId,
    start,
    end,
    timezone,
  }: InferenceTotalsQuery): Promise<InferenceMonthTotals[]> {
    const localMonth = sql<string>`to_char(${localDayIn(
      sql`(${schema.transactions.date}::timestamp AT TIME ZONE 'UTC')`,
      sql`${timezone}`,
    )}, 'YYYY-MM')`;

    const rows = await this.drizzle.db
      .select({
        month: localMonth,
        type: schema.transactions.type,
        categoryId: schema.transactions.categoryId,
        total: sum(schema.transactions.amount).mapWith(Number),
      })
      .from(schema.transactions)
      .innerJoin(
        schema.categories,
        eq(schema.transactions.categoryId, schema.categories.id),
      )
      .where(
        and(
          eq(schema.transactions.workspaceId, workspaceId),
          eq(schema.transactions.status, 'COMPLETED'),
          inArray(schema.transactions.type, [
            TransactionType.INCOME,
            TransactionType.EXPENSE,
          ]),
          gte(schema.transactions.date, start),
          lte(schema.transactions.date, end),
          ne(
            schema.transactions.categoryId,
            SYSTEM_CATEGORY.CREDIT_CARD_PAYMENT.id,
          ),
          not(
            and(
              eq(schema.transactions.type, TransactionType.INCOME),
              eq(schema.categories.name, INVESTMENTS_CATEGORY_NAME),
            )!,
          ),
        ),
      )
      .groupBy(
        sql`1`,
        schema.transactions.type,
        schema.transactions.categoryId,
      );

    return toInferenceMonthTotals(rows);
  }

  async findSuggestionCategories(
    workspaceId: string,
  ): Promise<SuggestionCategory[]> {
    const rows = await this.drizzle.db
      .select({
        id: schema.categories.id,
        name: schema.categories.name,
        parentId: schema.categories.parentId,
        hidden: schema.categories.isHidden,
      })
      .from(schema.categories)
      .where(
        and(
          eq(schema.categories.workspaceId, workspaceId),
          eq(schema.categories.type, TransactionType.EXPENSE),
        ),
      )
      .orderBy(asc(schema.categories.name));

    return rows;
  }

  async findSuggestionParameters(asOf: string): Promise<SuggestionParameters> {
    const [[wage], bracketRows, groups] = await Promise.all([
      this.drizzle.db
        .select({
          valueCents: schema.budgetParameters.valueCents,
          effectiveFrom: schema.budgetParameters.effectiveFrom,
        })
        .from(schema.budgetParameters)
        .where(
          and(
            eq(schema.budgetParameters.key, MINIMUM_WAGE_KEY),
            lte(schema.budgetParameters.effectiveFrom, asOf),
          ),
        )
        .orderBy(desc(schema.budgetParameters.effectiveFrom))
        .limit(1),
      this.drizzle.db
        .select()
        .from(schema.budgetIncomeBrackets)
        .where(
          eq(
            schema.budgetIncomeBrackets.version,
            sql`(SELECT MAX(${schema.budgetIncomeBrackets.version}) FROM ${schema.budgetIncomeBrackets})`,
          ),
        )
        .orderBy(asc(schema.budgetIncomeBrackets.position)),
      this.drizzle.db.select().from(schema.budgetCategoryGroups),
    ]);

    return {
      minimumWage: wage ?? null,
      bracketVersion: bracketRows[0]?.version ?? null,
      bracketRows: bracketRows.map((row) => ({
        position: row.position,
        maxMinimumWages: row.maxMinimumWages,
        essentialsBp: row.essentialsBp,
        lifestyleBp: row.lifestyleBp,
        savingsBp: row.savingsBp,
      })),
      groupByCategoryName: Object.fromEntries(
        groups.map((group) => [
          group.categoryName,
          group.budgetGroup as GroupKey,
        ]),
      ),
    };
  }

  async findSuggestionDecisions(
    workspaceId: string,
  ): Promise<SuggestionDecisionRecord[]> {
    const rows = await this.drizzle.db
      .select()
      .from(schema.budgetSuggestionDecisions)
      .where(eq(schema.budgetSuggestionDecisions.workspaceId, workspaceId));

    return rows.map((row) => ({
      kind: row.kind as SuggestionDecisionRecord['kind'],
      month: row.month.slice(0, MONTH_KEY_LENGTH),
      decision: row.decision as SuggestionDecisionRecord['decision'],
      incomeCents: row.incomeCents,
      bracketVersion: row.bracketVersion,
    }));
  }

  async saveSnapshotWithDecision(
    input: SaveSnapshotWithDecisionInput,
  ): Promise<SuggestionWriteOutcome> {
    const { workspaceId, effectiveFrom, decision } = input;

    try {
      return await this.drizzle.db.transaction(async (tx) => {
        await lockWorkspaceBudget(tx, workspaceId);

        if (await hasDecision(tx, decision)) return 'already-decided';
        const stillCurrent = await this.drizzle.runWithin(
          tx,
          input.isStillCurrent,
        );
        if (!stillCurrent) return 'drifted';

        const current = await loadApplicableSnapshot(
          tx,
          workspaceId,
          effectiveFrom,
        );
        if ((current?.monthlyIncome ?? null) !== input.expectedMonthlyIncome) {
          return 'drifted';
        }

        await writeSnapshot(tx, {
          workspaceId,
          effectiveFrom,
          ...planSuggestionSnapshot(current, input.write),
        });
        await insertDecision(tx, decision);

        return 'applied';
      });
    } catch (error) {
      return rethrowSnapshotWriteError(error);
    }
  }

  async saveDecision(
    input: SuggestionDecisionInput,
  ): Promise<SuggestionWriteOutcome> {
    return this.drizzle.db.transaction(async (tx) => {
      await lockWorkspaceBudget(tx, input.workspaceId);

      if (await hasDecision(tx, input)) return 'already-decided';

      await insertDecision(tx, input);

      return 'applied';
    });
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
          eq(schema.categories.isHidden, false),
          sql`${schema.categories.parentId} IS NULL`,
        ),
      )
      .orderBy(asc(schema.categories.name));
  }
}

type BudgetSnapshotRow = Omit<BudgetSnapshot, 'mode' | 'allocations'> & {
  mode: BudgetMode | null;
};

export function toBudgetSnapshot(
  row: BudgetSnapshotRow,
  allocations: BudgetAllocationRecord[],
): BudgetSnapshot {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    effectiveFrom: row.effectiveFrom,
    monthlyIncome: row.monthlyIncome,
    mode: row.mode ?? BUDGET_MODE_DEFAULT,
    allocations,
  };
}

type DrizzleExecutor = DrizzleService['db'] | DrizzleTransaction;

async function loadApplicableSnapshot(
  executor: DrizzleExecutor,
  workspaceId: string,
  monthStart: Date,
): Promise<BudgetSnapshot | null> {
  const snapshots = await executor
    .select()
    .from(schema.budgets)
    .where(eq(schema.budgets.workspaceId, workspaceId))
    .orderBy(desc(schema.budgets.effectiveFrom));

  const snapshot = pickApplicableSnapshot(snapshots, monthStart);
  if (!snapshot) return null;

  const allocations = await executor
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

  return toBudgetSnapshot(snapshot, allocations);
}

async function lockWorkspaceBudget(
  tx: DrizzleTransaction,
  workspaceId: string,
): Promise<void> {
  await tx.execute(sql`SET LOCAL lock_timeout = '5s'`);
  await tx.execute(sql`SET LOCAL statement_timeout = '10s'`);
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${workspaceId}))`);
}

async function writeSnapshot(
  tx: DrizzleTransaction,
  input: SaveBudgetSnapshotInput,
): Promise<SavedBudgetSnapshot> {
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
        .set({
          monthlyIncome: input.monthlyIncome,
          mode: input.mode,
        })
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
          mode: input.mode,
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
}

function rethrowSnapshotWriteError(error: unknown): never {
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

const decisionMonthOf = (decision: SuggestionDecisionRecord): string =>
  `${decision.month}-01`;

async function hasDecision(
  tx: DrizzleTransaction,
  decision: SuggestionDecisionInput,
): Promise<boolean> {
  const [existing] = await tx
    .select({ id: schema.budgetSuggestionDecisions.id })
    .from(schema.budgetSuggestionDecisions)
    .where(
      and(
        eq(schema.budgetSuggestionDecisions.workspaceId, decision.workspaceId),
        eq(schema.budgetSuggestionDecisions.kind, decision.kind),
        eq(schema.budgetSuggestionDecisions.month, decisionMonthOf(decision)),
      ),
    );

  return existing !== undefined;
}

async function insertDecision(
  tx: DrizzleTransaction,
  decision: SuggestionDecisionInput,
): Promise<void> {
  await tx
    .insert(schema.budgetSuggestionDecisions)
    .values({
      workspaceId: decision.workspaceId,
      kind: decision.kind,
      month: decisionMonthOf(decision),
      decision: decision.decision,
      incomeCents: decision.incomeCents,
      bracketVersion: decision.bracketVersion,
    })
    .onConflictDoNothing();
}

type InferenceRow = {
  month: string;
  type: string;
  categoryId: string;
  total: number;
};

function toInferenceMonthTotals(rows: InferenceRow[]): InferenceMonthTotals[] {
  const byMonth = new Map<string, InferenceMonthTotals>();

  for (const row of rows) {
    const month = byMonth.get(row.month) ?? {
      month: row.month,
      incomeCents: 0,
      expenseByCategory: {},
    };
    if (row.type === TransactionType.INCOME) month.incomeCents += row.total;
    if (row.type === TransactionType.EXPENSE) {
      month.expenseByCategory[row.categoryId] = row.total;
    }
    byMonth.set(row.month, month);
  }

  return [...byMonth.values()].sort((a, b) => a.month.localeCompare(b.month));
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
