import { AccountType } from '@constants/enums';
import { CacheProvider } from '@infra/cache/contracts/CacheProvider';
import { DrizzleService } from '@infra/databases/drizzle/drizzle.service';
import * as schema from '@infra/databases/drizzle/schema';
import { GetWorkspaceTimezoneService } from '@modules/workspace/services/get-workspace-timezone.service';
import { Injectable } from '@nestjs/common';
import { TokenPayloadBase } from '@providers/auth/strategys/jwtStrategy';
import { DateProvider } from '@providers/date/contracts/DateProvider';
import { Either, right } from '@shared/core/errors/Either';
import { MoneyUtils } from '@utils/MoneyUtils';
import { and, eq, gte, lt, lte, ne, or, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { BalanceEvolutionRequest } from './get-balance-evolution.dto';

type Request = BalanceEvolutionRequest & TokenPayloadBase;

export type DaySummary = {
  date: string;
  income: number;
  expense: number;
  balance: number;
};

type Response = {
  evolution: DaySummary[];
  investments: DaySummary[];
  totalInvested: number;
};

export type OpeningRow = {
  type: string;
  sourceType: string;
  destType: string | null;
  amount: number;
};

export type PeriodRow = OpeningRow & { date: Date };

type TypeResolver = (
  type: string,
  sourceType: string,
  destType: string | null,
) => string;

type QueryContext = {
  workspaceId: string;
  startDate: Date;
  endDate: Date;
};

type BuildDailySummaryParams = {
  opening: OpeningRow[];
  period: PeriodRow[];
  resolve: TypeResolver;
  dateProvider: DateProvider;
  timezone: string;
  startDate: Date;
  endDate: Date;
  explicitStartBalance?: number;
};

const CACHE_TTL = 5 * 60;

const destAccount = alias(schema.accounts, 'dest_account');
const sumAmount = sql<number>`SUM(${schema.transactions.amount})`
  .mapWith(Number)
  .as('total_amount');

const selectFields = {
  type: schema.transactions.type,
  sourceType: schema.accounts.type,
  destType: destAccount.type,
  amount: sumAmount,
} as const;

const groupByFields = [
  schema.transactions.type,
  schema.accounts.type,
  destAccount.type,
] as const;

const isCompleted = eq(schema.transactions.status, 'COMPLETED');
const isNotCreditCard = ne(schema.accounts.type, AccountType.CREDIT_CARD);
const isNotInvestment = ne(schema.accounts.type, AccountType.INVESTMENT);

const isCreditCardPayment = and(
  eq(schema.transactions.type, 'TRANSFER'),
  eq(destAccount.type, AccountType.CREDIT_CARD),
);

const isInvestmentBoundary = and(
  eq(schema.transactions.type, 'TRANSFER'),
  or(
    eq(schema.accounts.type, AccountType.INVESTMENT),
    eq(destAccount.type, AccountType.INVESTMENT),
  ),
);

const generalFilter = or(
  and(
    sql`${schema.transactions.type} IN ('INCOME', 'EXPENSE')`,
    isNotCreditCard,
    isNotInvestment,
  ),
  isCreditCardPayment,
  isInvestmentBoundary,
);

const investmentBaseFilter = and(
  sql`${schema.transactions.type} IN ('INCOME', 'EXPENSE')`,
  eq(schema.accounts.type, AccountType.INVESTMENT),
);

const investmentTransferFilter = and(
  eq(schema.transactions.type, 'TRANSFER'),
  or(
    eq(destAccount.type, AccountType.INVESTMENT),
    eq(schema.accounts.type, AccountType.INVESTMENT),
  ),
);

const investmentFilter = or(investmentBaseFilter, investmentTransferFilter);

export function resolveGeneralType(
  type: string,
  sourceType: string,
  destType: string | null,
): string {
  if (type === 'TRANSFER' && destType === AccountType.CREDIT_CARD)
    return 'EXPENSE';
  if (type === 'TRANSFER' && destType === AccountType.INVESTMENT)
    return 'EXPENSE';
  if (type === 'TRANSFER' && sourceType === AccountType.INVESTMENT)
    return 'INCOME';
  return type;
}

export function resolveInvestmentType(
  type: string,
  sourceType: string,
  destType: string | null,
): string {
  if (type === 'TRANSFER' && destType === AccountType.INVESTMENT)
    return 'INCOME';
  if (type === 'TRANSFER' && sourceType === AccountType.INVESTMENT)
    return 'EXPENSE';
  return type;
}

export function calculateNetPeriodEffect(
  period: PeriodRow[],
  resolve: TypeResolver,
): number {
  let net = 0;

  for (const row of period) {
    const effectiveType = resolve(row.type, row.sourceType, row.destType);
    if (effectiveType === 'INCOME') net += row.amount;
    if (effectiveType === 'EXPENSE') net -= row.amount;
  }

  return net;
}

type DailyBucket = { income: number; expense: number };

type BuildDailyBucketsParams = {
  dateProvider: DateProvider;
  timezone: string;
  startDate: Date;
  endDate: Date;
};

function buildDailyBuckets({
  dateProvider,
  timezone,
  startDate,
  endDate,
}: BuildDailyBucketsParams): Map<string, DailyBucket> {
  const dailyMap = new Map<string, DailyBucket>();

  for (let dayOffset = 0; ; dayOffset++) {
    const day = dateProvider.add(startDate, dayOffset, 'day', timezone);
    if (day.getTime() > endDate.getTime()) break;
    dailyMap.set(dateProvider.format(day, 'YYYY-MM-DD', timezone), {
      income: 0,
      expense: 0,
    });
  }

  return dailyMap;
}

type AccumulatePeriodParams = {
  dailyMap: Map<string, DailyBucket>;
  period: PeriodRow[];
  resolve: TypeResolver;
  dateProvider: DateProvider;
  timezone: string;
};

function accumulatePeriod({
  dailyMap,
  period,
  resolve,
  dateProvider,
  timezone,
}: AccumulatePeriodParams): void {
  for (const row of period) {
    const dateKey = dateProvider.format(row.date, 'YYYY-MM-DD', timezone);
    const day = dailyMap.get(dateKey);
    if (!day) continue;

    const effectiveType = resolve(row.type, row.sourceType, row.destType);
    if (effectiveType === 'INCOME') day.income += row.amount;
    if (effectiveType === 'EXPENSE') day.expense += row.amount;
  }
}

function applyOpeningBalance(
  opening: OpeningRow[],
  resolve: TypeResolver,
): number {
  let balance = 0;

  for (const row of opening) {
    const effectiveType = resolve(row.type, row.sourceType, row.destType);
    if (effectiveType === 'INCOME') balance += row.amount;
    if (effectiveType === 'EXPENSE') balance -= row.amount;
  }

  return balance;
}

function toDaySummaries(
  dailyMap: Map<string, DailyBucket>,
  startBalance: number,
): DaySummary[] {
  let accumulatedBalance = startBalance;
  const result: DaySummary[] = [];

  for (const [dateKey, dayData] of dailyMap.entries()) {
    accumulatedBalance += dayData.income - dayData.expense;

    result.push({
      date: dateKey,
      income: MoneyUtils.centsToDecimal(dayData.income),
      expense: MoneyUtils.centsToDecimal(dayData.expense),
      balance: MoneyUtils.centsToDecimal(accumulatedBalance),
    });
  }

  return result;
}

export function buildDailySummary({
  opening,
  period,
  resolve,
  dateProvider,
  timezone,
  startDate,
  endDate,
  explicitStartBalance,
}: BuildDailySummaryParams): DaySummary[] {
  const dailyMap = buildDailyBuckets({
    dateProvider,
    timezone,
    startDate,
    endDate,
  });
  accumulatePeriod({ dailyMap, period, resolve, dateProvider, timezone });
  const startBalance =
    explicitStartBalance ?? applyOpeningBalance(opening, resolve);

  return toDaySummaries(dailyMap, startBalance);
}

@Injectable()
export class BalanceEvolutionService {
  constructor(
    private readonly drizzle: DrizzleService,
    private readonly cache: CacheProvider,
    private readonly workspaceTimezone: GetWorkspaceTimezoneService,
    private readonly dateProvider: DateProvider,
  ) {}

  async execute({
    workspaceId,
    period,
  }: Request): Promise<Either<Error, Response>> {
    const cacheKey = `report:balance-evolution:${workspaceId}:${period}`;
    const cached = await this.cache.get(cacheKey);
    if (cached) return right(JSON.parse(cached) as Response);

    const timezone = await this.workspaceTimezone.execute(workspaceId);
    const now = this.dateProvider.now();
    const periodDays = period === '7d' ? 7 : 30;
    const startDate = this.dateProvider.startOfDay(
      this.dateProvider.add(now, -periodDays, 'day', timezone),
      timezone,
    );
    const endDate = this.dateProvider.endOfDay(now, timezone);

    const context: QueryContext = { workspaceId, startDate, endDate };

    const [
      generalOpening,
      generalPeriod,
      investmentOpening,
      investmentPeriod,
      totalInvestedResult,
    ] = await Promise.all([
      this.queryOpening(context, generalFilter),
      this.queryPeriod(context, generalFilter),
      this.queryOpening(context, investmentFilter),
      this.queryPeriod(context, investmentFilter),
      this.queryTotalInvested(workspaceId),
    ]);

    const evolution = buildDailySummary({
      opening: generalOpening,
      period: generalPeriod,
      resolve: resolveGeneralType,
      dateProvider: this.dateProvider,
      timezone,
      startDate,
      endDate,
    });

    const investments = buildDailySummary({
      opening: investmentOpening,
      period: investmentPeriod,
      resolve: resolveInvestmentType,
      dateProvider: this.dateProvider,
      timezone,
      startDate,
      endDate,
      explicitStartBalance:
        totalInvestedResult -
        calculateNetPeriodEffect(investmentPeriod, resolveInvestmentType),
    });

    const totalInvested = MoneyUtils.centsToDecimal(totalInvestedResult);

    const response: Response = { evolution, investments, totalInvested };

    await this.cache.set(cacheKey, JSON.stringify(response), CACHE_TTL);

    return right(response);
  }

  private async queryOpening(
    context: QueryContext,
    filter: ReturnType<typeof and>,
  ): Promise<OpeningRow[]> {
    return await this.drizzle.db
      .select(selectFields)
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
          eq(schema.transactions.workspaceId, context.workspaceId),
          isCompleted,
          lt(schema.transactions.date, context.startDate),
          filter,
        ),
      )
      .groupBy(...groupByFields);
  }

  private async queryPeriod(
    context: QueryContext,
    filter: ReturnType<typeof and>,
  ): Promise<PeriodRow[]> {
    return await this.drizzle.db
      .select({
        ...selectFields,
        date: schema.transactions.date,
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
          eq(schema.transactions.workspaceId, context.workspaceId),
          isCompleted,
          gte(schema.transactions.date, context.startDate),
          lte(schema.transactions.date, context.endDate),
          filter,
        ),
      )
      .groupBy(schema.transactions.date, ...groupByFields);
  }

  private async queryTotalInvested(workspaceId: string): Promise<number> {
    const result = await this.drizzle.db
      .select({
        total: sql<number>`COALESCE(SUM(${schema.accounts.balance}), 0)`
          .mapWith(Number)
          .as('total_invested'),
      })
      .from(schema.accounts)
      .where(
        and(
          eq(schema.accounts.workspaceId, workspaceId),
          eq(schema.accounts.type, AccountType.INVESTMENT),
        ),
      );

    return result[0]?.total ?? 0;
  }
}
