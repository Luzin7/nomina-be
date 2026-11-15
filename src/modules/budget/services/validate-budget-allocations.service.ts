import { BUDGET_MODE_DEFAULT, type BudgetMode } from '@constants/enums';
import {
  BudgetCategoryNotFoundError,
  DuplicateBudgetCategoryError,
  EmptyBudgetAllocationsError,
  ForbiddenBudgetCategoryError,
  HiddenBudgetCategoryError,
  InvalidBudgetPercentageSumError,
  InvalidBudgetTargetError,
  MixedBudgetModeFieldsError,
  NonRootBudgetCategoryError,
} from '@modules/budget/errors';
import {
  BudgetCategoryRef,
  BudgetRepository,
} from '@modules/budget/repositories/contracts/BudgetRepository';
import { Injectable } from '@nestjs/common';
import { Service } from '@shared/core/contracts/Service';
import { Either, left, right } from '@shared/core/errors/Either';

export type BudgetAllocationInput = {
  categoryId: string;
  percentageOfIncome?: number;
  targetCents?: number;
};

export type BudgetAllocationFields = {
  percentages: number[];
  targets: number[];
};

export type ValidateBudgetAllocationsRequest = {
  workspaceId: string;
  effectiveFrom: Date;
  mode: BudgetMode;
  allocations: BudgetAllocationInput[];
  requireRootCategories: boolean;
};

export type ValidateBudgetCategoriesRequest = Omit<
  ValidateBudgetAllocationsRequest,
  'mode'
>;

const TOTAL_PERCENTAGE = 100;

@Injectable()
export class ValidateBudgetAllocationsService implements Service<
  ValidateBudgetAllocationsRequest,
  Error,
  BudgetAllocationFields
> {
  constructor(private readonly budgetRepository: BudgetRepository) {}

  async execute({
    mode,
    ...request
  }: ValidateBudgetAllocationsRequest): Promise<
    Either<Error, BudgetAllocationFields>
  > {
    const fields = this.parseFields(mode, request.allocations);
    if (fields.isLeft()) return left(fields.value);

    const categoryError = await this.validateCategories(request);
    if (categoryError) return left(categoryError);

    return right(fields.value);
  }

  parseFields(
    mode: BudgetMode,
    allocations: BudgetAllocationInput[],
  ): Either<Error, BudgetAllocationFields> {
    return parseAllocationFields(mode, allocations);
  }

  async validateCategories({
    workspaceId,
    effectiveFrom,
    allocations,
    requireRootCategories,
  }: ValidateBudgetCategoriesRequest): Promise<Error | null> {
    const categories = await this.budgetRepository.findCategoriesByIds(
      allocations.map((allocation) => allocation.categoryId),
    );
    const categoriesById = new Map(
      categories.map((category) => [category.id, category]),
    );

    for (const allocation of allocations) {
      const error = categoryErrorOf(
        categoriesById.get(allocation.categoryId),
        workspaceId,
        requireRootCategories,
      );
      if (error) return error;
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

function categoryErrorOf(
  category: BudgetCategoryRef | undefined,
  workspaceId: string,
  requireRootCategories: boolean,
): Error | null {
  if (!category) return new BudgetCategoryNotFoundError();

  if (category.workspaceId !== null && category.workspaceId !== workspaceId) {
    return new ForbiddenBudgetCategoryError();
  }

  if (requireRootCategories && category.parentId)
    return new NonRootBudgetCategoryError();

  return null;
}

function parseAllocationFields(
  mode: BudgetMode,
  allocations: BudgetAllocationInput[],
): Either<Error, BudgetAllocationFields> {
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

function hasDuplicateCategory(allocations: BudgetAllocationInput[]): boolean {
  const seen = new Set<string>();

  for (const allocation of allocations) {
    if (seen.has(allocation.categoryId)) return true;
    seen.add(allocation.categoryId);
  }

  return false;
}

function collectPercentage(
  allocation: BudgetAllocationInput,
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
  allocation: BudgetAllocationInput,
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
