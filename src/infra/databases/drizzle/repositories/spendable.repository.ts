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
  SpendableRecurrence,
  SpendableRepository,
} from '@modules/spendable/repositories/contracts/SpendableRepository';
import { Injectable } from '@nestjs/common';
import { AnyColumn, SQL, and, eq, inArray, sql } from 'drizzle-orm';
import * as schema from '../schema';
import { withinLocalDays } from '../sql-helpers';

const CASH_ACCOUNT_TYPES = [AccountType.CHECKING, AccountType.CASH];
const INCOME_OR_EXPENSE = [TransactionType.INCOME, TransactionType.EXPENSE];

const epochMsInUtc = (column: AnyColumn | SQL) =>
  sql<string>`(EXTRACT(EPOCH FROM ${column}) * 1000)::bigint`;

const epochMsToDate = (epochMs: string) => new Date(Number(epochMs));

type PendingExpenseRow = {
  id: string;
  accountId: string;
  amount: number;
};

type DebitRow = {
  transactionId: string | null;
  accountId: string;
  debitedCents: number;
};

const debitKey = (transactionId: string, accountId: string): string =>
  `${transactionId}|${accountId}`;

const debitsByMovement = (debits: DebitRow[]): Map<string, number> =>
  new Map(
    debits.map((debit) => [
      debitKey(debit.transactionId ?? '', debit.accountId),
      debit.debitedCents,
    ]),
  );

const notDebitedCents = (
  expense: PendingExpenseRow,
  debits: Map<string, number>,
): number =>
  Math.max(
    0,
    expense.amount + (debits.get(debitKey(expense.id, expense.accountId)) ?? 0),
  );

type RecurrenceRow = {
  id: string;
  type: string;
  accountType: string;
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

  async sumPendingCashExpenses(input: SpendableCashFlowInput): Promise<number> {
    return this.drizzle.withStatementTimeout(async (tx) => {
      const expenses: PendingExpenseRow[] = await tx
        .select({
          id: schema.transactions.id,
          accountId: schema.transactions.accountId,
          amount: schema.transactions.amount,
        })
        .from(schema.transactions)
        .innerJoin(
          schema.accounts,
          eq(schema.accounts.id, schema.transactions.accountId),
        )
        .where(
          this.cashFlowConditions(
            input,
            TransactionType.EXPENSE,
            TransactionStatus.PENDING,
          ),
        );

      if (expenses.length === 0) return 0;

      const debits: DebitRow[] = await tx
        .select({
          transactionId: schema.balanceMovements.transactionId,
          accountId: schema.balanceMovements.accountId,
          debitedCents: sql<number>`LEAST(
            SUM(${schema.balanceMovements.delta}),
            0
          )`.mapWith(Number),
        })
        .from(schema.balanceMovements)
        .where(
          and(
            inArray(schema.balanceMovements.accountId, [
              ...new Set(expenses.map((expense) => expense.accountId)),
            ]),
            inArray(
              schema.balanceMovements.transactionId,
              expenses.map((expense) => expense.id),
            ),
          ),
        )
        .groupBy(
          schema.balanceMovements.transactionId,
          schema.balanceMovements.accountId,
        );

      const debited = debitsByMovement(debits);

      return expenses.reduce(
        (total, expense) => total + notDebitedCents(expense, debited),
        0,
      );
    });
  }

  async sumCompletedCashIncome(input: SpendableCashFlowInput): Promise<number> {
    return this.sumCashFlow(
      input,
      TransactionType.INCOME,
      TransactionStatus.COMPLETED,
    );
  }

  async listCashBalances(workspaceId: string): Promise<SpendableCashBalance[]> {
    return this.drizzle.withStatementTimeout(async (tx) => {
      return tx
        .select({
          accountId: schema.accounts.id,
          balanceCents: schema.accounts.balance,
        })
        .from(schema.accounts)
        .where(
          and(
            eq(schema.accounts.workspaceId, workspaceId),
            inArray(schema.accounts.type, CASH_ACCOUNT_TYPES),
          ),
        )
        .orderBy(schema.accounts.id);
    });
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
