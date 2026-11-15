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
import { BudgetRepository } from '@modules/budget/repositories/contracts/BudgetRepository';
import {
  ValidateBudgetAllocationsService,
  type ValidateBudgetAllocationsRequest,
} from './validate-budget-allocations.service';

const EFFECTIVE_FROM = new Date('2026-11-01T03:00:00.000Z');

const category = (
  id: string,
  overrides: Partial<{
    workspaceId: string | null;
    parentId: string | null;
    isHidden: boolean;
  }> = {},
) => ({
  id,
  name: `Category ${id}`,
  workspaceId: 'ws-1',
  parentId: null,
  isHidden: false,
  ...overrides,
});

const makeRequest = (
  overrides: Partial<ValidateBudgetAllocationsRequest> = {},
): ValidateBudgetAllocationsRequest => ({
  workspaceId: 'ws-1',
  effectiveFrom: EFFECTIVE_FROM,
  mode: 'fixed',
  allocations: [{ categoryId: 'cat-1', targetCents: 1000 }],
  requireRootCategories: true,
  ...overrides,
});

describe('ValidateBudgetAllocationsService', () => {
  let service: ValidateBudgetAllocationsService;
  let repository: jest.Mocked<BudgetRepository>;

  beforeEach(() => {
    repository = {
      findCategoriesByIds: jest
        .fn()
        .mockImplementation(async (ids: string[]) =>
          ids.map((id) => category(id)),
        ),
      resolveSnapshot: jest.fn().mockResolvedValue(null),
    } as unknown as jest.Mocked<BudgetRepository>;
    service = new ValidateBudgetAllocationsService(repository);
  });

  it('returns the targets of a valid fixed payload', async () => {
    const result = await service.execute(
      makeRequest({
        allocations: [
          { categoryId: 'cat-1', targetCents: 1000 },
          { categoryId: 'cat-2', targetCents: 0 },
        ],
      }),
    );

    expect(result.value).toEqual({ percentages: [], targets: [1000, 0] });
  });

  it('returns the percentages of a valid percentage payload', async () => {
    const result = await service.execute(
      makeRequest({
        mode: 'percentage',
        allocations: [
          { categoryId: 'cat-1', percentageOfIncome: 60 },
          { categoryId: 'cat-2', percentageOfIncome: 40 },
        ],
      }),
    );

    expect(result.value).toEqual({ percentages: [60, 40], targets: [] });
  });

  it('rejects an empty payload before loading categories', async () => {
    const result = await service.execute(makeRequest({ allocations: [] }));

    expect(result.value).toBeInstanceOf(EmptyBudgetAllocationsError);
    expect(repository.findCategoriesByIds).not.toHaveBeenCalled();
  });

  it('rejects a duplicated category', async () => {
    const result = await service.execute(
      makeRequest({
        allocations: [
          { categoryId: 'cat-1', targetCents: 1 },
          { categoryId: 'cat-1', targetCents: 2 },
        ],
      }),
    );

    expect(result.value).toBeInstanceOf(DuplicateBudgetCategoryError);
  });

  it.each([1.5, -1])('rejects the target %s', async (targetCents) => {
    const result = await service.execute(
      makeRequest({ allocations: [{ categoryId: 'cat-1', targetCents }] }),
    );

    expect(result.value).toBeInstanceOf(InvalidBudgetTargetError);
  });

  it('rejects a fixed payload carrying percentages', async () => {
    const result = await service.execute(
      makeRequest({
        allocations: [
          { categoryId: 'cat-1', targetCents: 1, percentageOfIncome: 10 },
        ],
      }),
    );

    expect(result.value).toBeInstanceOf(MixedBudgetModeFieldsError);
  });

  it('rejects percentages that do not sum to 100', async () => {
    const result = await service.execute(
      makeRequest({
        mode: 'percentage',
        allocations: [{ categoryId: 'cat-1', percentageOfIncome: 90 }],
      }),
    );

    expect(result.value).toBeInstanceOf(InvalidBudgetPercentageSumError);
  });

  it('rejects an unknown category', async () => {
    repository.findCategoriesByIds.mockResolvedValue([]);

    const result = await service.execute(makeRequest());

    expect(result.value).toBeInstanceOf(BudgetCategoryNotFoundError);
  });

  it('rejects a category of another workspace', async () => {
    repository.findCategoriesByIds.mockResolvedValue([
      category('cat-1', { workspaceId: 'ws-2' }),
    ]);

    const result = await service.execute(makeRequest());

    expect(result.value).toBeInstanceOf(ForbiddenBudgetCategoryError);
  });

  it('accepts a global category', async () => {
    repository.findCategoriesByIds.mockResolvedValue([
      category('cat-1', { workspaceId: null }),
    ]);

    const result = await service.execute(makeRequest());

    expect(result.isRight()).toBe(true);
  });

  it('rejects a subcategory', async () => {
    repository.findCategoriesByIds.mockResolvedValue([
      category('cat-1', { parentId: 'parent-1' }),
    ]);

    const result = await service.execute(makeRequest());

    expect(result.value).toBeInstanceOf(NonRootBudgetCategoryError);
  });

  it('accepts a subcategory when roots are not required', async () => {
    repository.findCategoriesByIds.mockResolvedValue([
      category('cat-1', { parentId: 'parent-1' }),
    ]);

    const result = await service.execute(
      makeRequest({ requireRootCategories: false }),
    );

    expect(result.isRight()).toBe(true);
  });

  it('rejects a hidden category missing from the snapshot', async () => {
    repository.findCategoriesByIds.mockResolvedValue([
      category('cat-1', { isHidden: true }),
    ]);

    const result = await service.execute(makeRequest());

    expect(result.value).toBeInstanceOf(HiddenBudgetCategoryError);
  });

  it('accepts a hidden category already in the snapshot', async () => {
    repository.findCategoriesByIds.mockResolvedValue([
      category('cat-1', { isHidden: true }),
    ]);
    repository.resolveSnapshot.mockResolvedValue({
      allocations: [{ categoryId: 'cat-1' }],
    } as never);

    const result = await service.execute(makeRequest());

    expect(result.isRight()).toBe(true);
  });

  it('does not load the snapshot when no category is hidden', async () => {
    await service.execute(makeRequest());

    expect(repository.resolveSnapshot).not.toHaveBeenCalled();
  });
});
