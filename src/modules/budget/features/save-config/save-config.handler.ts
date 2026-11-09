import { BudgetRepository } from '@modules/budget/repositories/contracts/BudgetRepository';
import {
  BudgetCategoryNotFoundError,
  BudgetSnapshotConflictError,
  DuplicateBudgetCategoryError,
  EmptyBudgetAllocationsError,
  ForbiddenBudgetCategoryError,
  HistoricalBudgetImmutableError,
  InvalidBudgetEffectiveDateError,
  InvalidBudgetPercentageSumError,
} from '@modules/budget/errors';
import { distributeTargets } from '@modules/budget/valueObjects/LargestRemainder';
import { GetWorkspaceTimezoneService } from '@modules/workspace/services/get-workspace-timezone.service';
import { Injectable } from '@nestjs/common';
import { TokenPayloadSchema } from '@providers/auth/strategys/jwtStrategy';
import { DateProvider } from '@providers/date/contracts/DateProvider';
import { Service } from '@shared/core/contracts/Service';
import { Either, left, right } from '@shared/core/errors/Either';
import { SaveBudgetConfigRequest } from './save-config.dto';

type Request = SaveBudgetConfigRequest &
  Pick<TokenPayloadSchema, 'workspaceId'>;

type Response = {
  id: string;
  effectiveFrom: Date;
};

const TOTAL_PERCENTAGE = 100;
const DEFAULT_GROUP_NAME = 'Geral';

@Injectable()
export class SaveBudgetConfigService implements Service<
  Request,
  Error,
  Response
> {
  constructor(
    private readonly budgetRepository: BudgetRepository,
    private readonly workspaceTimezone: GetWorkspaceTimezoneService,
    private readonly dateProvider: DateProvider,
  ) {}

  async execute(request: Request): Promise<Either<Error, Response>> {
    const { workspaceId, monthlyIncome, allocations } = request;

    if (allocations.length === 0) {
      return left(new EmptyBudgetAllocationsError());
    }

    if (this.hasDuplicateCategory(allocations)) {
      return left(new DuplicateBudgetCategoryError());
    }

    const percentageSum = allocations.reduce(
      (total, allocation) => total + allocation.percentageOfIncome,
      0,
    );
    if (percentageSum !== TOTAL_PERCENTAGE) {
      return left(new InvalidBudgetPercentageSumError(percentageSum));
    }

    const timezone = await this.workspaceTimezone.execute(workspaceId);
    const currentMonthStart = this.dateProvider.startOfMonth(
      this.dateProvider.now(),
      timezone,
    );
    const nextMonthStart = this.dateProvider.startOfMonth(
      this.dateProvider.add(currentMonthStart, 1, 'month', timezone),
      timezone,
    );

    const effectiveFrom = request.effectiveFrom
      ? this.dateProvider.startOfMonth(request.effectiveFrom, timezone)
      : nextMonthStart;

    if (effectiveFrom.getTime() < currentMonthStart.getTime()) {
      return left(new HistoricalBudgetImmutableError());
    }

    if (
      effectiveFrom.getTime() !== currentMonthStart.getTime() &&
      effectiveFrom.getTime() !== nextMonthStart.getTime()
    ) {
      return left(new InvalidBudgetEffectiveDateError());
    }

    const categoryError = await this.validateCategories(
      workspaceId,
      allocations,
    );
    if (categoryError) return left(categoryError);

    const targets = distributeTargets(
      monthlyIncome,
      allocations.map((allocation) => allocation.percentageOfIncome),
    );

    try {
      const saved = await this.budgetRepository.saveSnapshot({
        workspaceId,
        effectiveFrom,
        monthlyIncome,
        allocations: allocations.map((allocation, index) => ({
          categoryId: allocation.categoryId,
          groupName: allocation.groupName ?? DEFAULT_GROUP_NAME,
          groupOrder: allocation.groupOrder ?? 0,
          categoryOrder: allocation.categoryOrder ?? index,
          percentageOfIncome: allocation.percentageOfIncome,
          targetCents: targets[index],
        })),
      });

      return right(saved);
    } catch (error) {
      if (
        error instanceof BudgetSnapshotConflictError ||
        error instanceof ForbiddenBudgetCategoryError
      ) {
        return left(error);
      }

      throw error;
    }
  }

  private hasDuplicateCategory(
    allocations: SaveBudgetConfigRequest['allocations'],
  ): boolean {
    const seen = new Set<string>();

    for (const allocation of allocations) {
      if (seen.has(allocation.categoryId)) return true;
      seen.add(allocation.categoryId);
    }

    return false;
  }

  private async validateCategories(
    workspaceId: string,
    allocations: SaveBudgetConfigRequest['allocations'],
  ): Promise<Error | null> {
    const categories = await this.budgetRepository.findCategoriesByIds(
      allocations.map((allocation) => allocation.categoryId),
    );
    const categoriesById = new Map(
      categories.map((category) => [category.id, category]),
    );

    for (const allocation of allocations) {
      const category = categoriesById.get(allocation.categoryId);
      if (!category) return new BudgetCategoryNotFoundError();

      if (
        category.workspaceId !== null &&
        category.workspaceId !== workspaceId
      ) {
        return new ForbiddenBudgetCategoryError();
      }
    }

    return null;
  }
}
