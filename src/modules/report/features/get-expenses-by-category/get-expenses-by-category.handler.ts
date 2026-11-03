import { CacheProvider } from '@infra/cache/contracts/CacheProvider';
import { TransactionRepository } from '@modules/transaction/repositories/contracts/TransactionRepository';
import { GetWorkspaceTimezoneService } from '@modules/workspace/services/get-workspace-timezone.service';
import { Injectable } from '@nestjs/common';
import { TokenPayloadSchema } from '@providers/auth/strategys/jwtStrategy';
import { DateProvider } from '@providers/date/contracts/DateProvider';
import {
  REPORT_CACHE_TTL_SECONDS,
  readReportGeneration,
} from '@shared/cache/report-cache';
import { GetExpensesByCategoryRequest } from './get-expenses-by-category.dto';
import { TopExpensesByCategoryResult } from '@modules/report/presenters/TopExpensesByCategory.presenter';

type Request = GetExpensesByCategoryRequest &
  Pick<TokenPayloadSchema, 'workspaceId'>;

const TOP_CATEGORIES_LIMIT = 5;

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
  }: Request): Promise<TopExpensesByCategoryResult> {
    const generation = await readReportGeneration(this.cache, workspaceId);
    const cacheKey =
      generation === null
        ? null
        : `report:expenses-by-category:v3:${workspaceId}:g${generation}:${year}-${month}`;
    const cached = cacheKey ? await this.cache.get(cacheKey) : null;
    if (cached) return JSON.parse(cached) as TopExpensesByCategoryResult;

    const timezone = await this.workspaceTimezone.execute(workspaceId);
    const referenceDate = `${year}-${String(month).padStart(2, '0')}-01`;
    const startDate = this.dateProvider.startOfMonth(referenceDate, timezone);
    const endDate = this.dateProvider.endOfMonth(referenceDate, timezone);

    const { expenses, totalExpense } =
      await this.transactionRepository.getTopExpensesByCategory({
        workspaceId,
        startDate,
        endDate,
        pageSize: TOP_CATEGORIES_LIMIT,
      });

    const result: TopExpensesByCategoryResult = {
      expenses: expenses.map((expense) => ({
        categoryId: expense.categoryId,
        categoryName: expense.categoryName,
        amount: expense.amount,
      })),
      totalExpense,
    };

    if (cacheKey) {
      await this.cache.set(
        cacheKey,
        JSON.stringify(result),
        REPORT_CACHE_TTL_SECONDS,
      );
    }

    return result;
  }
}
