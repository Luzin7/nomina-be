import {
  AccountType,
  RecurrenceFrequency,
  TransactionStatus,
  TransactionType,
} from '@constants/enums';
import { DrizzleService } from '@infra/databases/drizzle/drizzle.service';
import {
  SpendableCashFlowInput,
  SpendableCashBalance,
  SpendableCashSnapshot,
  SpendableRecurrence,
  SpendableRepository,
} from '@modules/spendable/repositories/contracts/SpendableRepository';
import { Injectable } from '@nestjs/common';
import { SQL, and, eq, inArray, sql } from 'drizzle-orm';
import * as schema from '../schema';
import { epochMsInUtc, epochMsToDate, withinLocalDays } from '../sql-helpers';

const CASH_ACCOUNT_TYPES = [AccountType.CHECKING, AccountType.CASH];
const INCOME_OR_EXPENSE = [TransactionType.INCOME, TransactionType.EXPENSE];

type CashSnapshotRow = {
  pendingCents: string;
  cashBalances: SpendableCashBalance[];
};

const cashTypesIn = sql`(${sql.join(
  CASH_ACCOUNT_TYPES.map((type) => sql`${type}`),
  sql`, `,
)})`;

type RecurrenceRow = {
  id: string;
  type: string;
  accountType: string;
  timezone: string;
  amount: number;
  frequency: string;
  interval: number;
  startDateEpochMs: string;
  endDateEpochMs: string | null;
  lastGeneratedEpochMs: string | null;
  materializedDates: number[];
};

@Injectable()
export class SpendableRepositoryImplementation implements SpendableRepository {
  constructor(private readonly drizzle: DrizzleService) {}

  async findCycle(workspaceId: string): Promise<string | null> {
    return this.drizzle.withStatementTimeout(async (tx) => {
      const [workspace] = await tx
        .select({ cycle: schema.workspaces.cycle })
        .from(schema.workspaces)
        .where(eq(schema.workspaces.id, workspaceId))
        .limit(1);

      return workspace?.cycle ?? null;
    });
  }

  async readCashSnapshot(
    input: SpendableCashFlowInput,
  ): Promise<SpendableCashSnapshot> {
    return this.drizzle.withStatementTimeout(async (tx) => {
      const [row] = await tx.execute<CashSnapshotRow>(sql`
        WITH cash_accounts AS (
          SELECT a.id, a.balance
          FROM accounts a
          WHERE a.workspace_id = ${input.workspaceId}
            AND a.type IN ${cashTypesIn}
        ),
        pending AS (
          SELECT COALESCE(
            SUM(GREATEST(0, t.amount + LEAST(COALESCE((
              SELECT SUM(m.delta)
              FROM balance_movements m
              WHERE m.transaction_id = t.id
                AND m.account_id = t.account_id
            ), 0), 0))),
            0
          )::text AS "pendingCents"
          FROM transactions t
          INNER JOIN cash_accounts a ON a.id = t.account_id
          WHERE t.workspace_id = ${input.workspaceId}
            AND t.type = ${TransactionType.EXPENSE}
            AND t.status = ${TransactionStatus.PENDING}
            AND ${withinLocalDays(sql`t.date`, {
              start: input.startDate,
              end: input.endDate,
              timezone: input.timezone,
            })}
        )
        SELECT
          p."pendingCents",
          COALESCE((
            SELECT json_agg(
              json_build_object('accountId', c.id, 'balanceCents', c.balance)
              ORDER BY c.id
            )
            FROM cash_accounts c
          ), '[]'::json) AS "cashBalances"
        FROM pending p
      `);

      return {
        cashBalances: row.cashBalances,
        pendingCents: Number(row.pendingCents),
      };
    });
  }

  async sumCompletedCashIncome(input: SpendableCashFlowInput): Promise<number> {
    return this.sumCashFlow(
      input,
      TransactionType.INCOME,
      TransactionStatus.COMPLETED,
    );
  }

  async listActiveRecurrences(
    workspaceId: string,
  ): Promise<SpendableRecurrence[]> {
    const rows: RecurrenceRow[] = await this.drizzle.withStatementTimeout(
      async (tx) => {
        return tx
          .select({
            id: schema.recurringTransactions.id,
            type: schema.recurringTransactions.type,
            accountType: schema.accounts.type,
            timezone: schema.accounts.timezone,
            amount: schema.recurringTransactions.amount,
            frequency: schema.recurringTransactions.frequency,
            interval: schema.recurringTransactions.interval,
            startDateEpochMs: epochMsInUtc(
              schema.recurringTransactions.startDate,
            ),
            endDateEpochMs: epochMsInUtc(schema.recurringTransactions.endDate),
            lastGeneratedEpochMs: epochMsInUtc(
              schema.recurringTransactions.lastGenerated,
            ),
            materializedDates: sql<number[]>`COALESCE((
              SELECT json_agg(
                ${epochMsInUtc(sql`materialized.date`)}
                ORDER BY materialized.date
              )
              FROM transactions AS materialized
              WHERE materialized.recurring_transaction_id = recurring_transactions.id
            ), '[]'::json)`,
          })
          .from(schema.recurringTransactions)
          .innerJoin(
            schema.accounts,
            eq(schema.accounts.id, schema.recurringTransactions.accountId),
          )
          .where(
            and(
              eq(schema.recurringTransactions.workspaceId, workspaceId),
              eq(schema.recurringTransactions.active, true),
              inArray(schema.recurringTransactions.type, INCOME_OR_EXPENSE),
            ),
          );
      },
    );

    return rows.map((row) => ({
      id: row.id,
      type: row.type as SpendableRecurrence['type'],
      accountType: row.accountType as AccountType,
      timezone: row.timezone,
      amount: row.amount,
      frequency: row.frequency as RecurrenceFrequency,
      interval: row.interval,
      startDate: epochMsToDate(row.startDateEpochMs),
      endDate: row.endDateEpochMs ? epochMsToDate(row.endDateEpochMs) : null,
      lastGenerated: row.lastGeneratedEpochMs
        ? epochMsToDate(row.lastGeneratedEpochMs)
        : null,
      materializedDates: row.materializedDates.map(
        (epochMs) => new Date(epochMs),
      ),
    }));
  }

  private async sumCashFlow(
    input: SpendableCashFlowInput,
    type: TransactionType,
    status: TransactionStatus,
  ): Promise<number> {
    return this.drizzle.withStatementTimeout(async (tx) => {
      const [row] = await tx
        .select({
          total:
            sql<number>`COALESCE(SUM(${schema.transactions.amount}), 0)`.mapWith(
              Number,
            ),
        })
        .from(schema.transactions)
        .innerJoin(
          schema.accounts,
          eq(schema.accounts.id, schema.transactions.accountId),
        )
        .where(this.cashFlowConditions(input, type, status));

      return row.total;
    });
  }

  private cashFlowConditions(
    input: SpendableCashFlowInput,
    type: TransactionType,
    status: TransactionStatus,
  ): SQL | undefined {
    return and(
      eq(schema.transactions.workspaceId, input.workspaceId),
      eq(schema.transactions.type, type),
      eq(schema.transactions.status, status),
      inArray(schema.accounts.type, CASH_ACCOUNT_TYPES),
      withinLocalDays(schema.transactions.date, {
        start: input.startDate,
        end: input.endDate,
        timezone: input.timezone,
      }),
    );
  }
}
