import { BUDGET_MODE_DEFAULT, type BudgetMode } from '@constants/enums';
import { CacheProvider } from '@infra/cache/contracts/CacheProvider';
import {
  BudgetRepository,
  SaveBudgetAllocationInput,
  SavedBudgetSnapshot,
} from '@modules/budget/repositories/contracts/BudgetRepository';
import {
  BudgetCategoryNotFoundError,
  BudgetSnapshotConflictError,
  DuplicateBudgetCategoryError,
  EmptyBudgetAllocationsError,
  ForbiddenBudgetCategoryError,
  HiddenBudgetCategoryError,
  HistoricalBudgetImmutableError,
  InvalidBudgetEffectiveDateError,
  InvalidBudgetPercentageSumError,
  InvalidBudgetTargetError,
  MixedBudgetModeFieldsError,
} from '@modules/budget/errors';
import { resolveAllocationState } from '@modules/budget/valueObjects/BudgetAllocationState';
import type { BudgetAllocationState } from '@modules/budget/valueObjects/BudgetAllocationState';
import { distributeTargets } from '@modules/budget/valueObjects/LargestRemainder';
import { GetWorkspaceTimezoneService } from '@modules/workspace/services/get-workspace-timezone.service';
import { Injectable } from '@nestjs/common';
import { TokenPayloadSchema } from '@providers/auth/strategys/jwtStrategy';
import { DateProvider } from '@providers/date/contracts/DateProvider';
import { invalidateLedgerReads } from '@shared/cache/report-cache';
import { Service } from '@shared/core/contracts/Service';
import { Either, left, right } from '@shared/core/errors/Either';
import { SaveBudgetConfigRequest } from './save-config.dto';

type Request = SaveBudgetConfigRequest &
  Pick<TokenPayloadSchema, 'workspaceId'>;

type AllocationInput = SaveBudgetConfigRequest['allocations'][number];

type AllocationFields = {
  percentages: number[];
  targets: number[];
};

type ParseAllocationFieldsInput = {
  mode: BudgetMode;
  allocations: AllocationInput[];
};

type EffectiveFromInput = {
  request: Request;
  timezone: string;
  today: Date;
};

type BuildAllocationsInput = {
  mode: BudgetMode;
  monthlyIncome: number;
  allocations: AllocationInput[];
  fields: AllocationFields;
};

type ValidateCategoriesInput = {
  workspaceId: string;
  effectiveFrom: Date;
  allocations: AllocationInput[];
};

type BuildResponseInput = {
  saved: SavedBudgetSnapshot;
  mode: BudgetMode;
  monthlyIncome: number;
  allocations: SaveBudgetAllocationInput[];
};

export type SaveBudgetConfigResponse = {
  id: string;
  effectiveFrom: Date;
  mode: BudgetMode;
  monthlyIncomeCents: number;
  totalTargetCents: number;
  unallocatedIncomeCents: number;
  allocationState: BudgetAllocationState;
};

const TOTAL_PERCENTAGE = 100;
const DEFAULT_GROUP_NAME = 'Geral';

@Injectable()
export class SaveBudgetConfigService implements Service<
  Request,
  Error,
  SaveBudgetConfigResponse
> {
  constructor(
    private readonly budgetRepository: BudgetRepository,
    private readonly workspaceTimezone: GetWorkspaceTimezoneService,
    private readonly dateProvider: DateProvider,
    private readonly cache: CacheProvider,
  ) {}

  async execute(
    request: Request,
  ): Promise<Either<Error, SaveBudgetConfigResponse>> {
    const { workspaceId, monthlyIncome, allocations } = request;
    const { mode } = request;

    const fields = parseAllocationFields({ mode, allocations });
    if (fields.isLeft()) return left(fields.value);

    const timezone = await this.workspaceTimezone.execute(workspaceId);
    const effectiveFrom = this.resolveEffectiveFrom({
      request,
      timezone,
      today: this.dateProvider.now(),
    });
    if (effectiveFrom.isLeft()) return left(effectiveFrom.value);

    const categoryError = await this.validateCategories({
      workspaceId,
      effectiveFrom: effectiveFrom.value,
      allocations,
    });
    if (categoryError) return left(categoryError);

    const savedAllocations = this.buildAllocations({
      mode,
      monthlyIncome,
      allocations,
      fields: fields.value,
    });

    try {
      const saved = await this.budgetRepository.saveSnapshot({
        workspaceId,
        effectiveFrom: effectiveFrom.value,
        monthlyIncome,
        mode,
        allocations: savedAllocations,
      });
      await invalidateLedgerReads(
        this.cache,
        workspaceId,
        'save-budget-config',
      );

      return right(
        this.buildResponse({
          saved,
          mode,
          monthlyIncome,
          allocations: savedAllocations,
        }),
      );
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

  private resolveEffectiveFrom({
    request,
    timezone,
    today,
  }: EffectiveFromInput): Either<Error, Date> {
    const currentMonthStart = this.dateProvider.startOfMonth(today, timezone);
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

    return right(effectiveFrom);
  }

  private buildAllocations({
    mode,
    monthlyIncome,
    allocations,
    fields,
  }: BuildAllocationsInput): SaveBudgetAllocationInput[] {
    const targets =
      mode === BUDGET_MODE_DEFAULT
        ? distributeTargets(monthlyIncome, fields.percentages)
        : fields.targets;

    return allocations.map((allocation, index) => ({
      categoryId: allocation.categoryId,
      groupName: allocation.groupName ?? DEFAULT_GROUP_NAME,
      groupOrder: allocation.groupOrder ?? 0,
      categoryOrder: allocation.categoryOrder ?? index,
      percentageOfIncome:
        mode === BUDGET_MODE_DEFAULT
          ? fields.percentages[index]
          : Math.round((targets[index] / monthlyIncome) * 100),
      targetCents: targets[index],
    }));
  }

  private buildResponse({
    saved,
    mode,
    monthlyIncome,
    allocations,
  }: BuildResponseInput): SaveBudgetConfigResponse {
    const totalTargetCents = allocations.reduce(
      (total, allocation) => total + allocation.targetCents,
      0,
    );

    return {
      id: saved.id,
      effectiveFrom: saved.effectiveFrom,
      mode,
      monthlyIncomeCents: monthlyIncome,
      totalTargetCents,
      unallocatedIncomeCents: Math.max(0, monthlyIncome - totalTargetCents),
      allocationState: resolveAllocationState(monthlyIncome, totalTargetCents),
    };
  }

  private async validateCategories({
    workspaceId,
    effectiveFrom,
    allocations,
  }: ValidateCategoriesInput): Promise<Error | null> {
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

    const hidden = categories.filter((category) => category.isHidden);
    if (hidden.length === 0) return null;

    const snapshot = await this.budgetRepository.resolveSnapshot(
      workspaceId,
      effectiveFrom,
    );
    const allocatedIds = new Set(
      snapshot?.allocations.map((allocation) => allocation.categoryId),
    );

    return hidden.every((category) => allocatedIds.has(category.id))
      ? null
      : new HiddenBudgetCategoryError();
  }
}

function parseAllocationFields({
  mode,
  allocations,
}: ParseAllocationFieldsInput): Either<Error, AllocationFields> {
  if (allocations.length === 0) {
    return left(new EmptyBudgetAllocationsError());
  }

  if (hasDuplicateCategory(allocations)) {
    return left(new DuplicateBudgetCategoryError());
  }

  const percentages: number[] = [];
  const targets: number[] = [];

  for (const allocation of allocations) {
    const error =
      mode === BUDGET_MODE_DEFAULT
        ? collectPercentage(allocation, percentages)
        : collectTarget(allocation, targets);
    if (error) return left(error);
  }

  const percentageSum = percentages.reduce(
    (total, percentage) => total + percentage,
    0,
  );

  if (mode === BUDGET_MODE_DEFAULT && percentageSum !== TOTAL_PERCENTAGE) {
    return left(new InvalidBudgetPercentageSumError(percentageSum));
  }

  return right({ percentages, targets });
}

function hasDuplicateCategory(allocations: AllocationInput[]): boolean {
  const seen = new Set<string>();

  for (const allocation of allocations) {
    if (seen.has(allocation.categoryId)) return true;
    seen.add(allocation.categoryId);
  }

  return false;
}

function collectPercentage(
  allocation: AllocationInput,
  percentages: number[],
): Error | null {
  if (
    allocation.percentageOfIncome === undefined ||
    allocation.targetCents !== undefined
  ) {
    return new MixedBudgetModeFieldsError();
  }

  percentages.push(allocation.percentageOfIncome);
  return null;
}

function collectTarget(
  allocation: AllocationInput,
  targets: number[],
): Error | null {
  if (
    allocation.targetCents === undefined ||
    allocation.percentageOfIncome !== undefined
  ) {
    return new MixedBudgetModeFieldsError();
  }

  if (!Number.isInteger(allocation.targetCents) || allocation.targetCents < 0) {
    return new InvalidBudgetTargetError();
  }

  targets.push(allocation.targetCents);
  return null;
}
