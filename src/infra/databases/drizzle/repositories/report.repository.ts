import { DrizzleService } from '@infra/databases/drizzle/drizzle.service';
import {
  ReportRepository,
  SummaryMetrics,
  SummaryRanges,
} from '@modules/report/repositories/contracts/ReportRepository';
import { Injectable } from '@nestjs/common';
import { and, eq, gte, lte, SQL, sql } from 'drizzle-orm';
import * as schema from '../schema';

const transactions = schema.transactions;

const sumAmountBy = (condition: SQL) =>
  sql<number>`COALESCE(SUM(${transactions.amount}) FILTER (WHERE ${condition}), 0)`.mapWith(
    Number,
  );

@Injectable()
export class ReportRepositoryImplementation implements ReportRepository {
  constructor(private readonly drizzle: DrizzleService) {}

  async findMonthSummaryMetrics(
    workspaceId: string,
    ranges: SummaryRanges,
  ): Promise<SummaryMetrics> {
    const { currentStart, currentEnd, prevStart, prevEnd, prevMtdEnd } = ranges;

    const isIncome = eq(transactions.type, 'INCOME');
    const isExpense = eq(transactions.type, 'EXPENSE');
    const inCurrentMonth = and(
      gte(transactions.date, currentStart),
      lte(transactions.date, currentEnd),
    )!;
    const inPreviousMonth = and(
      gte(transactions.date, prevStart),
      lte(transactions.date, prevEnd),
    )!;
    const inPreviousMonthToDate = and(
      gte(transactions.date, prevStart),
      lte(transactions.date, prevMtdEnd),
    )!;

    const [result] = await this.drizzle.db
      .select({
        currentIncome: sumAmountBy(and(isIncome, inCurrentMonth)!),
        currentExpense: sumAmountBy(and(isExpense, inCurrentMonth)!),
        prevIncome: sumAmountBy(and(isIncome, inPreviousMonth)!),
        prevExpense: sumAmountBy(and(isExpense, inPreviousMonth)!),
        prevMtdIncome: sumAmountBy(and(isIncome, inPreviousMonthToDate)!),
        prevMtdExpense: sumAmountBy(and(isExpense, inPreviousMonthToDate)!),
      })
      .from(transactions)
      .where(
        and(
          eq(transactions.workspaceId, workspaceId),
          eq(transactions.status, 'COMPLETED'),
          gte(transactions.date, prevStart),
          lte(transactions.date, currentEnd),
        ),
      );

    return {
      currentMonthData: {
        totalIncome: result?.currentIncome ?? 0,
        totalExpense: result?.currentExpense ?? 0,
      },
      previousMonthData: {
        totalIncome: result?.prevIncome ?? 0,
        totalExpense: result?.prevExpense ?? 0,
      },
      previousMonthToDateData: {
        totalIncome: result?.prevMtdIncome ?? 0,
        totalExpense: result?.prevMtdExpense ?? 0,
      },
    };
  }
}
