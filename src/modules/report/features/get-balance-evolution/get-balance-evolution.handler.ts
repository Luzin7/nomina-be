import { AccountType } from '@constants/enums';
import { RedisService } from '@infra/cache/redis/RedisService';
import { DrizzleService } from '@infra/databases/drizzle/drizzle.service';
import * as schema from '@infra/databases/drizzle/schema';
import { Injectable } from '@nestjs/common';
import { TokenPayloadBase } from '@providers/auth/strategys/jwtStrategy';
import { Either, right } from '@shared/core/errors/Either';
import { MoneyUtils } from '@utils/MoneyUtils';
import { and, eq, gte, lt, lte, ne, or, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { BalanceEvolutionRequest } from './get-balance-evolution.dto';

type Request = BalanceEvolutionRequest & TokenPayloadBase;

type DaySummary = {
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

const CACHE_TTL = 5 * 60;

@Injectable()
export class BalanceEvolutionService {
  constructor(
    private readonly drizzle: DrizzleService,
    private readonly redisService: RedisService,
  ) {}

  async execute({
    workspaceId,
    period,
  }: Request): Promise<Either<Error, Response>> {
    const cacheKey = `report:balance-evolution:${workspaceId}:${period}`;
    const cached = await this.redisService.get(cacheKey);
    if (cached) return right(JSON.parse(cached) as Response);

    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(endDate.getDate() - (period === '7d' ? 7 : 30));

    const destAccount = alias(schema.accounts, 'dest_account');
    const sumAmount = sql<number>`SUM(${schema.transactions.amount})`
      .mapWith(Number)
      .as('total_amount');
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

    const queryOpening = async (
      filter: ReturnType<typeof and>,
    ): Promise<
      Array<{
        type: string;
        sourceType: string;
        destType: string | null;
        amount: number;
      }>
    > => {
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
            eq(schema.transactions.workspaceId, workspaceId),
            isCompleted,
            lt(schema.transactions.date, startDate),
            filter,
          ),
        )
        .groupBy(...groupByFields);
    };

    const queryPeriod = async (
      filter: ReturnType<typeof and>,
    ): Promise<
      Array<{
        type: string;
        sourceType: string;
        destType: string | null;
        amount: number;
        date: Date;
      }>
    > => {
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
            eq(schema.transactions.workspaceId, workspaceId),
            isCompleted,
            gte(schema.transactions.date, startDate),
            lte(schema.transactions.date, endDate),
            filter,
          ),
        )
        .groupBy(schema.transactions.date, ...groupByFields);
    };

    const queryTotalInvested = async (): Promise<number> => {
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
    };

    const [
      generalOpening,
      generalPeriod,
      investmentOpening,
      investmentPeriod,
      totalInvestedResult,
    ] = await Promise.all([
      queryOpening(generalFilter),
      queryPeriod(generalFilter),
      queryOpening(investmentFilter),
      queryPeriod(investmentFilter),
      queryTotalInvested(),
    ]);

    const resolveGeneralType = (
      type: string,
      sourceType: string,
      destType: string | null,
    ): string => {
      if (type === 'TRANSFER' && destType === AccountType.CREDIT_CARD)
        return 'EXPENSE';
      if (type === 'TRANSFER' && destType === AccountType.INVESTMENT)
        return 'EXPENSE';
      if (type === 'TRANSFER' && sourceType === AccountType.INVESTMENT)
        return 'INCOME';
      return type;
    };

    const resolveInvestmentType = (
      type: string,
      sourceType: string,
      destType: string | null,
    ): string => {
      if (type === 'TRANSFER' && destType === AccountType.INVESTMENT)
        return 'INCOME';
      if (type === 'TRANSFER' && sourceType === AccountType.INVESTMENT)
        return 'EXPENSE';
      return type;
    };

    const calculateNetPeriodEffect = (
      period: Array<{
        type: string;
        sourceType: string;
        destType: string | null;
        amount: number;
        date: Date;
      }>,
      resolve: (
        type: string,
        sourceType: string,
        destType: string | null,
      ) => string,
    ): number => {
      let net = 0;

      for (const row of period) {
        const effectiveType = resolve(row.type, row.sourceType, row.destType);
        if (effectiveType === 'INCOME') net += row.amount;
        if (effectiveType === 'EXPENSE') net -= row.amount;
      }

      return net;
    };

    const buildDailySummary = (
      opening: Array<{
        type: string;
        sourceType: string;
        destType: string | null;
        amount: number;
      }>,
      period: Array<{
        type: string;
        sourceType: string;
        destType: string | null;
        amount: number;
        date: Date;
      }>,
      resolve: (
        type: string,
        sourceType: string,
        destType: string | null,
      ) => string,
      explicitStartBalance?: number,
    ): DaySummary[] => {
      let accumulatedBalance = explicitStartBalance ?? 0;

      if (explicitStartBalance === undefined) {
        for (const row of opening) {
          const effectiveType = resolve(row.type, row.sourceType, row.destType);
          if (effectiveType === 'INCOME') accumulatedBalance += row.amount;
          if (effectiveType === 'EXPENSE') accumulatedBalance -= row.amount;
        }
      }

      const dailyMap = new Map<string, { income: number; expense: number }>();

      for (
        let d = new Date(startDate);
        d.getTime() <= endDate.getTime();
        d.setDate(d.getDate() + 1)
      ) {
        const key = d.toISOString().split('T')[0];
        dailyMap.set(key, { income: 0, expense: 0 });
      }

      for (const row of period) {
        const dateKey = row.date.toISOString().split('T')[0];
        const day = dailyMap.get(dateKey);
        if (!day) continue;

        const effectiveType = resolve(row.type, row.sourceType, row.destType);
        if (effectiveType === 'INCOME') day.income += row.amount;
        if (effectiveType === 'EXPENSE') day.expense += row.amount;
      }

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
    };

    const evolution = buildDailySummary(
      generalOpening,
      generalPeriod,
      resolveGeneralType,
    );

    const investments = buildDailySummary(
      investmentOpening,
      investmentPeriod,
      resolveInvestmentType,
      totalInvestedResult -
        calculateNetPeriodEffect(investmentPeriod, resolveInvestmentType),
    );

    const totalInvested = MoneyUtils.centsToDecimal(totalInvestedResult);

    const response: Response = { evolution, investments, totalInvested };

    await this.redisService.set(cacheKey, JSON.stringify(response), CACHE_TTL);

    return right(response);
  }
}
