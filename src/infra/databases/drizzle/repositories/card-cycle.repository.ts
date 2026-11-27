import { TransactionStatus, TransactionType } from '@constants/enums';
import { DrizzleService } from '@infra/databases/drizzle/drizzle.service';
import { MissingCardCyclePeriodError } from '../errors/MissingCardCyclePeriodError';
import { CardCycleBudgetExistsError } from '@modules/card-cycle/errors';
import {
  CardCycleBudgetLookup,
  CardCycleBudgetRecord,
  CardCyclePeriodRecord,
  CardCycleRepository,
  CardCycleSpendInput,
  MaterializeCardCyclePeriodInput,
  SaveCardCycleBudgetInput,
} from '@modules/card-cycle/repositories/contracts/CardCycleRepository';
import { Injectable } from '@nestjs/common';
import { getErrorDetails } from '@shared/utils/error-details';
import { and, desc, eq, lte, or, sql } from 'drizzle-orm';
import * as schema from '../schema';
import { withinLocalDays } from '../sql-helpers';

const UNIQUE_VIOLATION = '23505';
type CardCyclePeriodRow = typeof schema.cardCyclePeriods.$inferSelect;
type CardCycleBudgetRow = typeof schema.cardCycleBudgets.$inferSelect;

@Injectable()
export class CardCycleRepositoryImplementation implements CardCycleRepository {
  constructor(private readonly drizzle: DrizzleService) {}

  async materializePeriod(
    input: MaterializeCardCyclePeriodInput,
  ): Promise<CardCyclePeriodRecord> {
    const [inserted] = await this.drizzle.db
      .insert(schema.cardCyclePeriods)
      .values({
        workspaceId: input.workspaceId,
        accountId: input.accountId,
        ...input.window,
      })
      .onConflictDoNothing({
        target: [
          schema.cardCyclePeriods.accountId,
          schema.cardCyclePeriods.dueDate,
        ],
      })
      .returning();

    if (inserted) return toCardCyclePeriodRecord(inserted);

    const existing = await this.findPeriod(
      input.workspaceId,
      input.accountId,
      input.window.dueDate,
    );

    if (existing) return existing;

    throw new MissingCardCyclePeriodError({
      workspaceId: input.workspaceId,
      accountId: input.accountId,
      dueDate: input.window.dueDate,
    });
  }

  async findPeriod(
    workspaceId: string,
    accountId: string,
    dueDate: string,
  ): Promise<CardCyclePeriodRecord | null> {
    const [row] = await this.drizzle.db
      .select()
      .from(schema.cardCyclePeriods)
      .where(
        and(
          eq(schema.cardCyclePeriods.workspaceId, workspaceId),
          eq(schema.cardCyclePeriods.accountId, accountId),
          eq(schema.cardCyclePeriods.dueDate, dueDate),
        ),
      );

    return row ? toCardCyclePeriodRecord(row) : null;
  }

  async findApplicableBudget(
    workspaceId: string,
    accountId: string,
    dueDate: string,
  ): Promise<CardCycleBudgetRecord | null> {
    return this.drizzle.withStatementTimeout(async (tx) => {
      const [row] = await tx
        .select()
        .from(schema.cardCycleBudgets)
        .where(
          and(
            eq(schema.cardCycleBudgets.workspaceId, workspaceId),
            eq(schema.cardCycleBudgets.accountId, accountId),
            lte(schema.cardCycleBudgets.effectiveFrom, dueDate),
          ),
        )
        .orderBy(desc(schema.cardCycleBudgets.effectiveFrom))
        .limit(1);

      return row ? toCardCycleBudgetRecord(row) : null;
    });
  }

  async findApplicableBudgets(
    workspaceId: string,
    lookups: CardCycleBudgetLookup[],
  ): Promise<Map<string, CardCycleBudgetRecord>> {
    const uniqueLookups = firstPerAccount(lookups);
    if (uniqueLookups.length === 0) return new Map();

    return this.drizzle.withStatementTimeout(async (tx) => {
      const rows = await tx
        .select()
        .from(schema.cardCycleBudgets)
        .where(
          and(
            eq(schema.cardCycleBudgets.workspaceId, workspaceId),
            or(
              ...uniqueLookups.map(({ accountId, dueDate }) =>
                and(
                  eq(schema.cardCycleBudgets.accountId, accountId),
                  lte(schema.cardCycleBudgets.effectiveFrom, dueDate),
                ),
              ),
            ),
          ),
        )
        .orderBy(desc(schema.cardCycleBudgets.effectiveFrom));

      const budgets = new Map<string, CardCycleBudgetRecord>();
      for (const row of rows) {
        if (budgets.has(row.accountId)) continue;
        budgets.set(row.accountId, toCardCycleBudgetRecord(row));
      }

      return budgets;
    });
  }

  async saveBudget(
    input: SaveCardCycleBudgetInput,
  ): Promise<CardCycleBudgetRecord> {
    try {
      return await this.drizzle.db.transaction(async (tx) => {
        const lockKey = `${input.workspaceId}:${input.accountId}`;

        await tx.execute(
          sql`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`,
        );

        const [saved] = await tx
          .insert(schema.cardCycleBudgets)
          .values({
            workspaceId: input.workspaceId,
            accountId: input.accountId,
            effectiveFrom: input.effectiveFrom,
            limitCents: input.limitCents,
          })
          .returning();

        return toCardCycleBudgetRecord(saved);
      });
    } catch (error) {
      const details = getErrorDetails(error);

      if (details.sqlState === UNIQUE_VIOLATION) {
        throw new CardCycleBudgetExistsError();
      }

      throw error;
    }
  }

  async listPeriods(
    workspaceId: string,
    accountId: string,
    limit: number,
  ): Promise<CardCyclePeriodRecord[]> {
    const rows = await this.drizzle.db
      .select()
      .from(schema.cardCyclePeriods)
      .where(
        and(
          eq(schema.cardCyclePeriods.workspaceId, workspaceId),
          eq(schema.cardCyclePeriods.accountId, accountId),
        ),
      )
      .orderBy(desc(schema.cardCyclePeriods.dueDate))
      .limit(limit);

    return rows.map(toCardCyclePeriodRecord);
  }

  async sumCycleSpend(input: CardCycleSpendInput): Promise<number> {
    return this.drizzle.withStatementTimeout(async (tx) => {
      const [row] = await tx
        .select({
          total:
            sql<number>`COALESCE(SUM(${schema.transactions.amount}), 0)`.mapWith(
              Number,
            ),
        })
        .from(schema.transactions)
        .where(
          and(
            eq(schema.transactions.workspaceId, input.workspaceId),
            eq(schema.transactions.accountId, input.accountId),
            eq(schema.transactions.type, TransactionType.EXPENSE),
            eq(schema.transactions.status, TransactionStatus.COMPLETED),
            withinLocalDays(schema.transactions.date, {
              start: input.periodStart,
              end: input.periodEnd,
              timezone: input.timezone,
            }),
          ),
        );

      return row.total;
    });
  }

  async sumCycleSpends(
    inputs: CardCycleSpendInput[],
  ): Promise<Map<string, number>> {
    const uniqueInputs = firstPerAccount(inputs);
    if (uniqueInputs.length === 0) return new Map();

    return this.drizzle.withStatementTimeout(async (tx) => {
      const rows = await tx
        .select({
          accountId: schema.transactions.accountId,
          total:
            sql<number>`COALESCE(SUM(${schema.transactions.amount}), 0)`.mapWith(
              Number,
            ),
        })
        .from(schema.transactions)
        .where(
          and(
            eq(schema.transactions.type, TransactionType.EXPENSE),
            eq(schema.transactions.status, TransactionStatus.COMPLETED),
            or(
              ...uniqueInputs.map((input) =>
                and(
                  eq(schema.transactions.workspaceId, input.workspaceId),
                  eq(schema.transactions.accountId, input.accountId),
                  withinLocalDays(schema.transactions.date, {
                    start: input.periodStart,
                    end: input.periodEnd,
                    timezone: input.timezone,
                  }),
                ),
              ),
            ),
          ),
        )
        .groupBy(schema.transactions.accountId);

      return new Map(
        rows.map((row): [string, number] => [row.accountId, row.total]),
      );
    });
  }
}

function toCardCyclePeriodRecord(
  row: CardCyclePeriodRow,
): CardCyclePeriodRecord {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    accountId: row.accountId,
    dueDate: row.dueDate,
    periodStart: row.periodStart,
    periodEnd: row.periodEnd,
    dueDay: row.dueDay,
    closingDaysBeforeDue: row.closingDaysBeforeDue,
    materializedAt: row.createdAt,
  };
}

function toCardCycleBudgetRecord(
  row: CardCycleBudgetRow,
): CardCycleBudgetRecord {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    accountId: row.accountId,
    effectiveFrom: row.effectiveFrom,
    limitCents: row.limitCents,
  };
}

function firstPerAccount<T extends { accountId: string }>(items: T[]): T[] {
  const seen = new Set<string>();

  return items.filter((item) => {
    if (seen.has(item.accountId)) return false;
    seen.add(item.accountId);

    return true;
  });
}
