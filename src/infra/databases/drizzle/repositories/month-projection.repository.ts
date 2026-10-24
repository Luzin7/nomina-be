import { RecurrenceFrequency } from '@constants/enums';
import { DrizzleService } from '@infra/databases/drizzle/drizzle.service';
import { localDayIn } from '@infra/databases/drizzle/sql-helpers';
import {
  DateRange,
  MonthLedgerQuery,
  MonthProjectionRepository,
} from '@modules/report/repositories/contracts/MonthProjectionRepository';
import {
  LedgerMonth,
  RecurringRuleSnapshot,
} from '@modules/report/valueObjects/MonthProjection';
import { SYSTEM_CATEGORY_LIST } from '@modules/category/constants/system-categories';
import { Injectable } from '@nestjs/common';
import {
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

type RecurringRuleRow = {
  id: string;
  type: string;
  amount: number;
  frequency: string;
  interval: number;
  startDate: Date;
  endDate: Date | null;
  lastGenerated: Date | null;
  materializedDates: number[];
};

@Injectable()
export class MonthProjectionRepositoryImplementation implements MonthProjectionRepository {
  constructor(private readonly drizzle: DrizzleService) {}

  async findMonthLedger(query: MonthLedgerQuery): Promise<LedgerMonth[]> {
    const { workspaceId, timezone, range, currentMonthStart } = query;
    const localDay = localDayIn(
      sql`(${transactions.date}::timestamp AT TIME ZONE 'UTC')`,
      sql`${timezone}`,
    );
    const isPending = eq(transactions.status, 'PENDING');
    const isCompleted = eq(transactions.status, 'COMPLETED');
    const isExpense = eq(transactions.type, 'EXPENSE');
    const isPlain = and(
      isExpense,
      isNull(transactions.recurringId),
      isNull(transactions.installmentGroupId),
      notInArray(transactions.categoryId, SYSTEM_CATEGORY_IDS),
      or(isCompleted, gte(transactions.date, currentMonthStart)),
    )!;

    const rows = await this.drizzle.db
      .select({
        month: sql<string>`to_char(${localDay}, 'YYYY-MM')`,
        totalExpense: sumWhere(and(isCompleted, isExpense)!),
        pendingIncome: sumWhere(
          and(isPending, eq(transactions.type, 'INCOME'))!,
        ),
        pendingExpense: sumWhere(and(isPending, isExpense)!),
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
      totalExpense: row.totalExpense,
      pending: {
        totalIncome: row.pendingIncome,
        totalExpense: row.pendingExpense,
      },
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
        amount: recurringTransactions.amount,
        frequency: recurringTransactions.frequency,
        interval: recurringTransactions.interval,
        startDate: recurringTransactions.startDate,
        endDate: recurringTransactions.endDate,
        lastGenerated: recurringTransactions.lastGenerated,
        materializedDates: sql<number[]>`COALESCE((
          SELECT json_agg(
            (EXTRACT(EPOCH FROM (materialized.date::timestamp AT TIME ZONE 'UTC')) * 1000)::bigint
            ORDER BY materialized.date
          )
          FROM transactions AS materialized
          WHERE materialized.recurring_transaction_id = recurring_transactions.id
            AND (materialized.date::timestamp AT TIME ZONE 'UTC') >= ${month.start.toISOString()}::timestamptz
            AND (materialized.date::timestamp AT TIME ZONE 'UTC') <= ${month.end.toISOString()}::timestamptz
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
      amount: row.amount,
      frequency: row.frequency as RecurrenceFrequency,
      interval: row.interval,
      startDate: row.startDate,
      endDate: row.endDate,
      lastGenerated: row.lastGenerated,
      materializedDates: row.materializedDates.map(
        (epochMs) => new Date(epochMs),
      ),
    }));
  }
}
