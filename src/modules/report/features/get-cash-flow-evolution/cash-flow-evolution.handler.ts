import { AccountType } from '@constants/enums';
import { DrizzleService } from '@infra/databases/drizzle/drizzle.service';
import * as schema from '@infra/databases/drizzle/schema';
import { GetWorkspaceTimezoneService } from '@modules/workspace/services/get-workspace-timezone.service';
import { Injectable } from '@nestjs/common';
import { TokenPayloadSchema } from '@providers/auth/strategys/jwtStrategy';
import { DateProvider } from '@providers/date/contracts/DateProvider';
import { MoneyUtils } from '@utils/MoneyUtils';
import { and, desc, eq, gte, lte, ne, or, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { CashFlowEvolutionRequest } from './cash-flow-evolution.dto';

type Request = CashFlowEvolutionRequest &
  Pick<TokenPayloadSchema, 'workspaceId'>;
type Response = Array<{
  date: string;
  income: number;
  expense: number;
  balance: number;
}>;

@Injectable()
export class CashFlowEvolutionService {
  constructor(
    private readonly drizzle: DrizzleService,
    private readonly dateProvider: DateProvider,
    private readonly workspaceTimezone: GetWorkspaceTimezoneService,
  ) {}

  async execute({
    workspaceId,
    startDate,
    endDate,
  }: Request): Promise<Response> {
    const timezone = await this.workspaceTimezone.execute(workspaceId);

    const start = this.dateProvider.startOfDay(startDate, timezone);
    const end = this.dateProvider.endOfDay(endDate, timezone);

    const destAccount = alias(schema.accounts, 'dest_account');

    const effectiveType = sql<string>`CASE WHEN ${schema.transactions.type} = 'TRANSFER' AND ${destAccount.type} = ${AccountType.CREDIT_CARD} THEN 'EXPENSE' ELSE ${schema.transactions.type} END`;

    const dateFormatted = sql<string>`to_char(${schema.transactions.date} AT TIME ZONE 'UTC' AT TIME ZONE ${timezone}, 'YYYY-MM-DD')`;

    const incomes =
      sql<number>`COALESCE(SUM(CASE WHEN ${effectiveType} = 'INCOME' THEN ${schema.transactions.amount} ELSE 0 END), 0)`.mapWith(
        Number,
      );
    const expenses =
      sql<number>`COALESCE(SUM(CASE WHEN ${effectiveType} = 'EXPENSE' THEN ${schema.transactions.amount} ELSE 0 END), 0)`.mapWith(
        Number,
      );

    const reportFilter = or(
      and(
        sql`${schema.transactions.type} IN ('INCOME', 'EXPENSE')`,
        ne(schema.accounts.type, AccountType.CREDIT_CARD),
      ),
      and(
        eq(schema.transactions.type, 'TRANSFER'),
        eq(destAccount.type, AccountType.CREDIT_CARD),
      ),
    );

    const aggregates = await this.drizzle.db
      .select({
        date: dateFormatted,
        income: incomes,
        expense: expenses,
        balance: sql<number>`(${incomes}) - (${expenses})`.mapWith(Number),
      })
      .from(schema.transactions)
      .innerJoin(
        schema.accounts,
        eq(schema.transactions.accountId, schema.accounts.id),
      )
      .leftJoin(
        destAccount,
        eq(schema.transactions.destinationAccountId, destAccount.id),
      )
      .where(
        and(
          eq(schema.transactions.workspaceId, workspaceId),
          eq(schema.transactions.status, 'COMPLETED'),
          gte(schema.transactions.date, start),
          lte(schema.transactions.date, end),
          reportFilter,
        ),
      )
      .groupBy(dateFormatted)
      .orderBy(desc(dateFormatted));

    return aggregates.map((item) => ({
      date: item.date,
      income: MoneyUtils.centsToDecimal(item.income),
      expense: MoneyUtils.centsToDecimal(item.expense),
      balance: MoneyUtils.centsToDecimal(item.balance),
    }));
  }
}
