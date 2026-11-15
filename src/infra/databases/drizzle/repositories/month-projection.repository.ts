import { RecurrenceFrequency } from '@constants/enums';
import { DrizzleService } from '@infra/databases/drizzle/drizzle.service';
import { instantOf, localDayIn } from '@infra/databases/drizzle/sql-helpers';
import {
  DateRange,
  MonthLedgerQuery,
  MonthProjectionRepository,
} from '@modules/report/repositories/contracts/MonthProjectionRepository';
import {
  LedgerMonth,
  RecurringRuleSnapshot,
} from '@modules/report/valueObjects/MonthProjection';
import type { PendingInstallment } from '@modules/report/valueObjects/ProjectionHorizon';
import { SYSTEM_CATEGORY_LIST } from '@modules/category/constants/system-categories';
import { Injectable } from '@nestjs/common';
import {
  AnyColumn,
  and,
  eq,
  gte,
  inArray,
  isNull,
  lte,
  notInArray,
  or,
  SQL,
  sql,
} from 'drizzle-orm';
import * as schema from '../schema';

const recurringTransactions = schema.recurringTransactions;

const transactions = schema.transactions;

const sumWhere = (condition: SQL) =>
  sql<number>`COALESCE(SUM(${transactions.amount}) FILTER (WHERE ${condition}), 0)`.mapWith(
    Number,
  );

type PlainExpenseTuple = [number, string, number, boolean];

const SYSTEM_CATEGORY_IDS = SYSTEM_CATEGORY_LIST.map((category) => category.id);

const INCOME_OR_EXPENSE = ['INCOME', 'EXPENSE'];

const epochMsInUtc = (column: AnyColumn | SQL) =>
  sql<string>`(EXTRACT(EPOCH FROM ${column}) * 1000)::bigint`;

const epochMsToDate = (epochMs: string) => new Date(Number(epochMs));

type RecurringRuleRow = {
  id: string;
  type: string;
  categoryId: string | null;
  amount: number;
  frequency: string;
  interval: number;
  startDateEpochMs: string;
  endDateEpochMs: string | null;
  lastGeneratedEpochMs: string | null;
  materializedDates: number[];
};

@Injectable()
export class MonthProjectionRepositoryImplementation implements MonthProjectionRepository {
  constructor(private readonly drizzle: DrizzleService) {}

  async findMonthLedger(query: MonthLedgerQuery): Promise<LedgerMonth[]> {
    const { workspaceId, timezone, range, currentMonthStart } = query;
    const localDay = localDayIn(instantOf(transactions.date), sql`${timezone}`);
    const isPending = eq(transactions.status, 'PENDING');
    const isCompleted = eq(transactions.status, 'COMPLETED');
    const isExpense = eq(transactions.type, 'EXPENSE');
    const isIncome = eq(transactions.type, 'INCOME');
    const isPlain = and(
      isExpense,
      isNull(transactions.recurringId),
      isNull(transactions.installmentGroupId),
      notInArray(transactions.categoryId, SYSTEM_CATEGORY_IDS),
      or(isCompleted, gte(transactions.date, currentMonthStart)),
    )!;

    const isCountable = and(
      isCompleted,
      inArray(transactions.type, INCOME_OR_EXPENSE),
      or(
        isNull(transactions.categoryId),
        notInArray(transactions.categoryId, SYSTEM_CATEGORY_IDS),
      ),
    )!;

    const rows = await this.drizzle.db
      .select({
        month: sql<string>`to_char(${localDay}, 'YYYY-MM')`,
        totalIncome: sumWhere(and(isCompleted, isIncome)!),
        totalExpense: sumWhere(and(isCompleted, isExpense)!),
        pendingIncome: sumWhere(
          and(isPending, eq(transactions.type, 'INCOME'))!,
        ),
        pendingExpense: sumWhere(and(isPending, isExpense)!),
        completedCount: sql<number>`(COUNT(*) FILTER (WHERE ${isCountable}))::int`,
        plainExpenses: sql<PlainExpenseTuple[]>`COALESCE(
          json_agg(
            json_build_array(
              EXTRACT(DAY FROM ${localDay})::int,
              ${transactions.categoryId},
              ${transactions.amount},
              ${isPending}
            ) ORDER BY ${localDay}, ${transactions.id}
          ) FILTER (WHERE ${isPlain}),
          '[]'::json
        )`,
      })
      .from(transactions)
      .where(
        and(
          eq(transactions.workspaceId, workspaceId),
          gte(transactions.date, range.start),
          lte(transactions.date, range.end),
        ),
      )
      .groupBy(sql`1`)
      .orderBy(sql`1`);

    return rows.map((row) => ({
      key: row.month,
      totalIncome: row.totalIncome,
      totalExpense: row.totalExpense,
      pending: {
        totalIncome: row.pendingIncome,
        totalExpense: row.pendingExpense,
      },
      completedCount: row.completedCount,
      plainExpenses: row.plainExpenses.map(
        ([day, categoryId, amount, pending]) => ({
          day,
          categoryId,
          amount,
          pending,
        }),
      ),
    }));
  }

  async findActiveRecurringRules(
    workspaceId: string,
    month: DateRange,
  ): Promise<RecurringRuleSnapshot[]> {
    const rows: RecurringRuleRow[] = await this.drizzle.db
      .select({
        id: recurringTransactions.id,
        type: recurringTransactions.type,
        categoryId: recurringTransactions.categoryId,
        amount: recurringTransactions.amount,
        frequency: recurringTransactions.frequency,
        interval: recurringTransactions.interval,
        startDateEpochMs: epochMsInUtc(recurringTransactions.startDate),
        endDateEpochMs: epochMsInUtc(recurringTransactions.endDate),
        lastGeneratedEpochMs: epochMsInUtc(recurringTransactions.lastGenerated),
        materializedDates: sql<number[]>`COALESCE((
          SELECT json_agg(
            ${epochMsInUtc(sql`materialized.date`)}
            ORDER BY materialized.date
          )
          FROM transactions AS materialized
          WHERE materialized.recurring_transaction_id = recurring_transactions.id
            AND ${instantOf(sql`materialized.date`)} >= ${month.start.toISOString()}::timestamptz
            AND ${instantOf(sql`materialized.date`)} <= ${month.end.toISOString()}::timestamptz
        ), '[]'::json)`,
      })
      .from(recurringTransactions)
      .where(
        and(
          eq(recurringTransactions.workspaceId, workspaceId),
          eq(recurringTransactions.active, true),
          inArray(recurringTransactions.type, INCOME_OR_EXPENSE),
          lte(recurringTransactions.startDate, month.end),
          or(
            isNull(recurringTransactions.endDate),
            gte(recurringTransactions.endDate, month.start),
          ),
        ),
      );

    return rows.map((row) => ({
      id: row.id,
      type: row.type as RecurringRuleSnapshot['type'],
      categoryId: row.categoryId,
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

  async findPendingInstallments(
    workspaceId: string,
    range: DateRange,
  ): Promise<PendingInstallment[]> {
    const rows = await this.drizzle.db
      .select({
        dateEpochMs: epochMsInUtc(transactions.date),
        amount: transactions.amount,
        type: transactions.type,
        recurringId: transactions.recurringId,
        installmentNumber: transactions.installmentNumber,
        installmentCount: transactions.installmentCount,
      })
      .from(transactions)
      .where(
        and(
          eq(transactions.workspaceId, workspaceId),
          eq(transactions.status, 'PENDING'),
          inArray(transactions.type, INCOME_OR_EXPENSE),
          gte(transactions.date, range.start),
          lte(transactions.date, range.end),
        ),
      )
      .orderBy(transactions.date);

    return rows.map(({ dateEpochMs, ...row }) => ({
      ...row,
      date: epochMsToDate(dateEpochMs),
      type: row.type as PendingInstallment['type'],
    }));
  }
}
