import { TransactionStatus, TransactionType } from '@constants/enums';
import { DrizzleService } from '@infra/databases/drizzle/drizzle.service';
import { CardInvoiceRepository } from '@modules/account/repositories/contracts/CardInvoiceRepository';
import {
  CardInvoiceTotals,
  CardInvoiceWindow,
} from '@modules/account/valueObjects/CardInvoiceWindow';
import { Transaction } from '@modules/transaction/entities/Transaction';
import { Injectable } from '@nestjs/common';
import { and, desc, eq, or, SQL, sql } from 'drizzle-orm';
import { TransactionMapper } from '../mappers/transaction.mapper';
import * as schema from '../schema';
import { instantOf, localDayIn } from '../sql-helpers';

type TotalsRow = {
  idx: number;
  chargesBeforePeriod: string;
  paymentsBeforePeriod: string;
  chargesInPeriod: string;
  paymentsInPeriod: string;
  paymentsAfterClosing: string;
  pendingCharges: string;
};

const localDay = localDayIn(instantOf(sql`t.date`), sql`w.timezone`);
const isPaymentToCard = sql`(t.destination_account_id IS NOT DISTINCT FROM w.account_id OR t.type = ${TransactionType.INCOME})`;
const isCompleted = sql`t.status = ${TransactionStatus.COMPLETED}`;
const isPending = sql`t.status = ${TransactionStatus.PENDING}`;
const isPosted = sql`${localDay} <= w.today`;
const isInPeriod = sql`${localDay} BETWEEN w.period_start AND w.period_end`;

const sumWhere = (condition: SQL): SQL =>
  sql`COALESCE(SUM(t.amount) FILTER (WHERE ${condition}), 0)::text`;

const windowValues = (window: CardInvoiceWindow, idx: number): SQL =>
  sql`(${idx}::int, ${window.accountId}::text, ${window.periodStart}::date, ${window.periodEnd}::date, ${window.today}::date, ${window.timezone}::text)`;

const totalsOf = (row: TotalsRow): CardInvoiceTotals => ({
  chargesBeforePeriod: BigInt(row.chargesBeforePeriod),
  paymentsBeforePeriod: BigInt(row.paymentsBeforePeriod),
  chargesInPeriod: BigInt(row.chargesInPeriod),
  paymentsInPeriod: BigInt(row.paymentsInPeriod),
  paymentsAfterClosing: BigInt(row.paymentsAfterClosing),
  pendingCharges: BigInt(row.pendingCharges),
});

@Injectable()
export class CardInvoiceRepositoryImplementation implements CardInvoiceRepository {
  constructor(private readonly drizzle: DrizzleService) {}

  async findTotals(
    workspaceId: string,
    windows: CardInvoiceWindow[],
  ): Promise<CardInvoiceTotals[]> {
    if (windows.length === 0) return [];

    const values = sql.join(
      windows.map((window, idx) => windowValues(window, idx)),
      sql`, `,
    );

    const rows = await this.drizzle.db.execute<TotalsRow>(sql`
      SELECT
        w.idx AS "idx",
        ${sumWhere(sql`${isCompleted} AND NOT ${isPaymentToCard} AND ${localDay} < w.period_start AND ${isPosted}`)} AS "chargesBeforePeriod",
        ${sumWhere(sql`${isCompleted} AND ${isPaymentToCard} AND ${localDay} < w.period_start AND ${isPosted}`)} AS "paymentsBeforePeriod",
        ${sumWhere(sql`${isCompleted} AND NOT ${isPaymentToCard} AND ${isInPeriod} AND ${isPosted}`)} AS "chargesInPeriod",
        ${sumWhere(sql`${isCompleted} AND ${isPaymentToCard} AND ${isInPeriod} AND ${isPosted}`)} AS "paymentsInPeriod",
        ${sumWhere(sql`${isCompleted} AND ${isPaymentToCard} AND ${localDay} > w.period_end AND ${isPosted}`)} AS "paymentsAfterClosing",
        ${sumWhere(sql`${isPending} AND NOT ${isPaymentToCard} AND ${isInPeriod}`)} AS "pendingCharges"
      FROM (VALUES ${values}) AS w(idx, account_id, period_start, period_end, today, timezone)
      LEFT JOIN transactions t
        ON t.workspace_id = ${workspaceId}
        AND (t.account_id = w.account_id OR t.destination_account_id = w.account_id)
      GROUP BY w.idx
      ORDER BY w.idx
    `);

    return Array.from(rows, totalsOf);
  }

  async findPeriodTransactions(
    workspaceId: string,
    window: CardInvoiceWindow,
  ): Promise<Transaction[]> {
    const day = localDayIn(
      instantOf(schema.transactions.date),
      sql`${window.timezone}::text`,
    );

    const rows = await this.drizzle.db
      .select()
      .from(schema.transactions)
      .where(
        and(
          eq(schema.transactions.workspaceId, workspaceId),
          or(
            eq(schema.transactions.accountId, window.accountId),
            eq(schema.transactions.destinationAccountId, window.accountId),
          ),
          sql`${day} BETWEEN ${window.periodStart}::date AND ${window.periodEnd}::date`,
        ),
      )
      .orderBy(desc(schema.transactions.date));

    return rows.map(TransactionMapper.toDomain);
  }
}
