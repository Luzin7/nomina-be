import { AccountType } from '@constants/enums';
import { RedisService } from '@infra/cache/redis/RedisService';
import { DrizzleService } from '@infra/databases/drizzle/drizzle.service';
import * as schema from '@infra/databases/drizzle/schema';
import { Injectable } from '@nestjs/common';
import { TokenPayloadSchema } from '@providers/auth/strategys/jwtStrategy';
import { DateProvider } from '@providers/date/contracts/DateProvider';
import { MoneyUtils } from '@utils/MoneyUtils';
import { and, desc, eq, gte, lte, or, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { GetExpensesByCategoryRequest } from './get-expenses-by-category.dto';

type Request = GetExpensesByCategoryRequest &
  Pick<TokenPayloadSchema, 'workspaceId'>;
type Response = Array<{
  categoryId: string;
  categoryName: string;
  totalAmount: number;
  percentage: number;
}>;

const TOP_CATEGORIES_LIMIT = 5;
const CACHE_TTL = 5 * 60; // 5 minutes

@Injectable()
export class GetExpensesByCategoryService {
  constructor(
    private readonly drizzle: DrizzleService,
    private readonly dateProvider: DateProvider,
    private readonly redisService: RedisService,
  ) {}

  async execute({ workspaceId, month, year }: Request): Promise<Response> {
    const cacheKey = `report:expenses-by-category:${workspaceId}:${year}-${month}`;
    const cached = await this.redisService.get(cacheKey);
    if (cached) return JSON.parse(cached) as Response;

    const workspaceTimezone = 'America/Sao_Paulo';
    const referenceDateStr = `${year}-${String(month).padStart(2, '0')}-01`;
    const startDate = this.dateProvider.startOfMonth(
      referenceDateStr,
      workspaceTimezone,
    );
    const endDate = this.dateProvider.endOfMonth(
      referenceDateStr,
      workspaceTimezone,
    );

    const destAccount = alias(schema.accounts, 'dest_account');

    const reportFilter = or(
      eq(schema.transactions.type, 'EXPENSE'),
      and(
        eq(schema.transactions.type, 'TRANSFER'),
        eq(destAccount.type, AccountType.CREDIT_CARD),
      ),
    );

    const whereConditions = and(
      eq(schema.transactions.workspaceId, workspaceId),
      gte(schema.transactions.date, startDate),
      eq(schema.transactions.status, 'COMPLETED'),
      lte(schema.transactions.date, endDate),
      reportFilter,
    );

    const totalAmountSql =
      sql<number>`COALESCE(SUM(${schema.transactions.amount}), 0)`.mapWith(
        Number,
      );

    const [[{ grandTotal }], expenses] = await Promise.all([
      this.drizzle.db
        .select({ grandTotal: totalAmountSql })
        .from(schema.transactions)
        .leftJoin(
          destAccount,
          eq(schema.transactions.destinationAccountId, destAccount.id),
        )
        .where(whereConditions),

      this.drizzle.db
        .select({
          categoryId: schema.categories.id,
          categoryName: schema.categories.name,
          totalAmount: totalAmountSql,
        })
        .from(schema.transactions)
        .leftJoin(
          destAccount,
          eq(schema.transactions.destinationAccountId, destAccount.id),
        )
        .leftJoin(
          schema.categories,
          eq(schema.transactions.categoryId, schema.categories.id),
        )
        .where(whereConditions)
        .groupBy(schema.categories.id, schema.categories.name)
        .orderBy(desc(totalAmountSql))
        .limit(TOP_CATEGORIES_LIMIT),
    ]);

    if (grandTotal === 0) return [];

    let sumOfTopCategories = 0;

    const result: Response = expenses.map((expense) => {
      sumOfTopCategories += expense.totalAmount;
      return {
        categoryId: expense.categoryId ?? 'uncategorized',
        categoryName: expense.categoryName ?? 'Sem Categoria',
        totalAmount: MoneyUtils.centsToDecimal(expense.totalAmount),
        percentage: Number(
          ((expense.totalAmount / grandTotal) * 100).toFixed(2),
        ),
      };
    });

    const othersAmount = grandTotal - sumOfTopCategories;

    if (othersAmount > 0) {
      result.push({
        categoryId: 'others',
        categoryName: 'Outros',
        totalAmount: MoneyUtils.centsToDecimal(othersAmount),
        percentage: Number(((othersAmount / grandTotal) * 100).toFixed(2)),
      });
    }

    await this.redisService.set(cacheKey, JSON.stringify(result), CACHE_TTL);

    return result;
  }
}
