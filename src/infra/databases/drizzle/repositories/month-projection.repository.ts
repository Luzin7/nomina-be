import { RecurrenceFrequency } from '@constants/enums';
import { DrizzleService } from '@infra/databases/drizzle/drizzle.service';
import { SYSTEM_CATEGORY_LIST } from '@modules/category/constants/system-categories';
import {
  DateRange,
  MonthProjectionRepository,
  ProjectionTotals,
  ProjectionTotalsQuery,
} from '@modules/report/repositories/contracts/MonthProjectionRepository';
import { RecurringRuleSnapshot } from '@modules/report/valueObjects/MonthProjection';
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

const transactions = schema.transactions;
const recurringTransactions = schema.recurringTransactions;

const SYSTEM_CATEGORY_IDS = SYSTEM_CATEGORY_LIST.map((category) => category.id);
const INCOME_OR_EXPENSE = ['INCOME', 'EXPENSE'];

const withinRange = (range: DateRange): SQL =>
  and(gte(transactions.date, range.start), lte(transactions.date, range.end))!;

const completedExpense = and(
  eq(transactions.status, 'COMPLETED'),
  eq(transactions.type, 'EXPENSE'),
)!;

const variableExpense = and(
  completedExpense,
  isNull(transactions.recurringId),
  isNull(transactions.installmentGroupId),
  notInArray(transactions.categoryId, SYSTEM_CATEGORY_IDS),
)!;

const sumWhere = (condition: SQL) =>
  sql<number>`COALESCE(SUM(${transactions.amount}) FILTER (WHERE ${condition}), 0)`.mapWith(
    Number,
  );

const pendingOfType = (type: 'INCOME' | 'EXPENSE', month: DateRange): SQL =>
  and(
    eq(transactions.status, 'PENDING'),
    eq(transactions.type, type),
    withinRange(month),
  )!;

type RecurringRuleRow = {
  id: string;
  type: string;
  amount: number;
  frequency: string;
  interval: number;
  startDate: Date;
  endDate: Date | null;
  lastGenerated: Date | null;
  materializedDates: string[];
};

@Injectable()
export class MonthProjectionRepositoryImplementation implements MonthProjectionRepository {
  constructor(private readonly drizzle: DrizzleService) {}

  async sumProjectionTotals(
    query: ProjectionTotalsQuery,
  ): Promise<ProjectionTotals> {
    const { workspaceId, currentMonth, today, basisMonths } = query;
    const earliestStart = basisMonths.at(-1)?.start ?? currentMonth.start;

    const basisColumns = Object.fromEntries(
      basisMonths.flatMap((month, index) => [
        [
          `basisTotalExpense${index}`,
          sumWhere(and(completedExpense, withinRange(month))!),
        ],
        [
          `basisVariableExpense${index}`,
          sumWhere(and(variableExpense, withinRange(month))!),
        ],
      ]),
    );

    const [row] = await this.drizzle.db
      .select({
        scheduledIncome: sumWhere(pendingOfType('INCOME', currentMonth)),
        scheduledExpense: sumWhere(pendingOfType('EXPENSE', currentMonth)),
        variableExpenseToday: sumWhere(
          and(variableExpense, withinRange(today))!,
        ),
        ...basisColumns,
        firstActivityAt: sql<Date | string | null>`(
          SELECT MIN(${transactions.date})
          FROM ${transactions}
          WHERE ${transactions.workspaceId} = ${workspaceId}
            AND ${transactions.status} = 'COMPLETED'
            AND ${inArray(transactions.type, INCOME_OR_EXPENSE)}
        )`,
      })
      .from(transactions)
      .where(
        and(
          eq(transactions.workspaceId, workspaceId),
          gte(transactions.date, earliestStart),
          lte(transactions.date, currentMonth.end),
        ),
      );

    const basisRow = row as unknown as Record<string, number>;

    return {
      scheduled: {
        totalIncome: row.scheduledIncome,
        totalExpense: row.scheduledExpense,
      },
      variableExpenseToday: row.variableExpenseToday,
      basisMonths: basisMonths.map((_, index) => ({
        totalExpense: basisRow[`basisTotalExpense${index}`],
        variableExpense: basisRow[`basisVariableExpense${index}`],
      })),
      firstActivityAt: row.firstActivityAt
        ? new Date(row.firstActivityAt)
        : null,
    };
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
        materializedDates: sql<string[]>`COALESCE((
          SELECT json_agg(materialized.date ORDER BY materialized.date)
          FROM transactions AS materialized
          WHERE materialized.recurring_transaction_id = recurring_transactions.id
            AND materialized.date >= ${month.start.toISOString()}::timestamptz
            AND materialized.date <= ${month.end.toISOString()}::timestamptz
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
      materializedDates: row.materializedDates.map((date) => new Date(date)),
    }));
  }
}
