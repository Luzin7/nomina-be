import { CacheProvider } from '@infra/cache/contracts/CacheProvider';
import { TransactionRepository } from '@modules/transaction/repositories/contracts/TransactionRepository';
import { GetWorkspaceTimezoneService } from '@modules/workspace/services/get-workspace-timezone.service';
import { Injectable } from '@nestjs/common';
import { TokenPayloadSchema } from '@providers/auth/strategys/jwtStrategy';
import { DateProvider } from '@providers/date/contracts/DateProvider';
import { GetExpensesByCategoryRequest } from './get-expenses-by-category.dto';
import { TopExpensesByCategoryResult } from '@modules/report/presenters/TopExpensesByCategory.presenter';

type Request = GetExpensesByCategoryRequest &
  Pick<TokenPayloadSchema, 'workspaceId'>;

const TOP_CATEGORIES_LIMIT = 5;
const CACHE_TTL = 5 * 60;

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
    const cacheKey = `report:expenses-by-category:v2:${workspaceId}:${year}-${month}`;
    const cached = await this.cache.get(cacheKey);
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

    await this.cache.set(cacheKey, JSON.stringify(result), CACHE_TTL);

    return result;
  }
}
