import { CacheProvider } from '@infra/cache/contracts/CacheProvider';
import { TransactionRepository } from '@modules/transaction/repositories/contracts/TransactionRepository';
import { GetWorkspaceTimezoneService } from '@modules/workspace/services/get-workspace-timezone.service';
import { Injectable } from '@nestjs/common';
import { TokenPayloadSchema } from '@providers/auth/strategys/jwtStrategy';
import { DateProvider } from '@providers/date/contracts/DateProvider';
import { buildCacheKey } from '@shared/cache/cache-key';
import { readThrough } from '@shared/cache/read-through';
import { right } from '@shared/core/errors/Either';
import {
  LEDGER_CACHE_TTL_SECONDS,
  readLedgerGeneration,
} from '@shared/cache/report-cache';
import { readCategoryGeneration } from '@modules/category/services/category-list-cache';
import { GetExpensesByCategoryRequest } from './get-expenses-by-category.dto';
import { TopExpensesByCategoryResult } from '@modules/report/presenters/TopExpensesByCategory.presenter';

type Request = GetExpensesByCategoryRequest &
  Pick<TokenPayloadSchema, 'workspaceId'>;

@Injectable()
export class GetExpensesByCategoryService {
  constructor(
    private readonly transactionRepository: TransactionRepository,
    private readonly workspaceTimezone: GetWorkspaceTimezoneService,
    private readonly dateProvider: DateProvider,
    private readonly cache: CacheProvider,
  ) {}

  async execute({
    workspaceId,
    month,
    year,
    limit,
  }: Request): Promise<TopExpensesByCategoryResult> {
    const [ledger, category, timezone] = await Promise.all([
      readLedgerGeneration(this.cache, workspaceId),
      readCategoryGeneration(this.cache, workspaceId),
      this.workspaceTimezone.execute(workspaceId),
    ]);
    const localDay = this.dateProvider.format(
      this.dateProvider.now(),
      'YYYY-MM-DD',
      timezone,
    );

    const result = await readThrough<never, TopExpensesByCategoryResult>({
      cache: this.cache,
      key: buildCacheKey({
        route: 'report:expenses-by-category',
        version: 'v6',
        workspaceId,
        generations: { ledger, category },
        parts: [`${year}-${month}`, localDay, limit],
      }),
      ttlSeconds: LEDGER_CACHE_TTL_SECONDS,
      load: async () =>
        right(await this.summarize(workspaceId, timezone, month, year, limit)),
    });

    return result.value;
  }

  private async summarize(
    workspaceId: string,
    timezone: string,
    month: Request['month'],
    year: Request['year'],
    limit: Request['limit'],
  ): Promise<TopExpensesByCategoryResult> {
    const monthKey = `${year}-${String(month).padStart(2, '0')}`;
    const referenceDate = `${monthKey}-01`;
    const isCurrentMonth =
      this.dateProvider.format(this.dateProvider.now(), 'YYYY-MM', timezone) ===
      monthKey;
    const startDate = this.dateProvider.startOfMonth(referenceDate, timezone);
    const endDate = this.dateProvider.endOfMonth(referenceDate, timezone);

    const { expenses, totalExpense } =
      await this.transactionRepository.getTopExpensesByCategory({
        workspaceId,
        startDate,
        endDate,
        pageSize: limit,
        isCurrentMonth,
      });

    return {
      expenses: expenses.map((expense) => ({
        categoryId: expense.categoryId,
        categoryName: expense.categoryName,
        amount: expense.amount,
      })),
      totalExpense,
    };
  }
}
