import {
  BudgetRepository,
  SaveBudgetAllocationInput,
} from '@modules/budget/repositories/contracts/BudgetRepository';
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
import { GetWorkspaceTimezoneService } from '@modules/workspace/services/get-workspace-timezone.service';
import { DayJsDateProvider } from '@providers/date/implementations/Dayjs';
import { SaveBudgetConfigRequest } from './save-config.dto';
import { SaveBudgetConfigService } from './save-config.handler';

const NOW = new Date('2026-11-09T12:00:00.000Z');
const TIMEZONE = 'America/Sao_Paulo';
const CURRENT_MONTH_START = new Date('2026-11-01T03:00:00.000Z');
const NEXT_MONTH_START = new Date('2026-12-01T03:00:00.000Z');

function makeAllocation(
  overrides: Partial<SaveBudgetConfigRequest['allocations'][number]> = {},
): SaveBudgetConfigRequest['allocations'][number] {
  return {
    categoryId: 'cat-1',
    percentageOfIncome: 100,
    ...overrides,
  };
}

function makeRequest(
  overrides: Partial<SaveBudgetConfigRequest> = {},
): SaveBudgetConfigRequest {
  return {
    monthlyIncome: 10_000,
    allocations: [makeAllocation()],
    ...overrides,
  };
}

function category(id: string, workspaceId: string | null = 'ws-1') {
  return { id, name: `Category ${id}`, workspaceId };
}

describe('SaveBudgetConfigService', () => {
  let service: SaveBudgetConfigService;
  let repository: jest.Mocked<BudgetRepository>;
  let workspaceTimezone: jest.Mocked<GetWorkspaceTimezoneService>;
  let dateProvider: DayJsDateProvider;
  let savedInputs: SaveBudgetAllocationInput[][];

  beforeEach(() => {
    savedInputs = [];
    repository = {
      resolveSnapshot: jest.fn(),
      findCategoriesByIds: jest
        .fn()
        .mockImplementation(async (ids: string[]) =>
          ids.map((id) => category(id)),
        ),
      findCompletedExpenseByCategory: jest.fn(),
      saveSnapshot: jest.fn().mockImplementation(async (input) => {
        savedInputs.push(input.allocations);
        return { id: 'budget-1', effectiveFrom: input.effectiveFrom };
      }),
      findMonthlyIncomeSuggestion: jest.fn(),
      findPresetCategories: jest.fn(),
    } as unknown as jest.Mocked<BudgetRepository>;

    workspaceTimezone = {
      execute: jest.fn().mockResolvedValue(TIMEZONE),
    } as unknown as jest.Mocked<GetWorkspaceTimezoneService>;

    dateProvider = new DayJsDateProvider();
    jest.spyOn(dateProvider, 'now').mockReturnValue(NOW);

    service = new SaveBudgetConfigService(
      repository,
      workspaceTimezone,
      dateProvider,
    );
  });

  afterEach(() => jest.restoreAllMocks());

  it('rejects a payload with zero allocations', async () => {
    const result = await service.execute({
      workspaceId: 'ws-1',
      ...makeRequest({ allocations: [] }),
    });

    expect(result.isLeft()).toBe(true);
    if (result.isLeft()) {
      expect(result.value).toBeInstanceOf(EmptyBudgetAllocationsError);
    }
    expect(repository.saveSnapshot).not.toHaveBeenCalled();
  });

  it.each([99, 101])('rejects a percentage sum of %i', async (sum) => {
    const result = await service.execute({
      workspaceId: 'ws-1',
      ...makeRequest({
        allocations: [
          makeAllocation({ categoryId: 'cat-1', percentageOfIncome: sum - 1 }),
          makeAllocation({ categoryId: 'cat-2', percentageOfIncome: 1 }),
        ],
      }),
    });

    expect(result.isLeft()).toBe(true);
    if (result.isLeft()) {
      expect(result.value).toBeInstanceOf(InvalidBudgetPercentageSumError);
    }
    expect(repository.saveSnapshot).not.toHaveBeenCalled();
  });

  it('rejects a duplicated category', async () => {
    const result = await service.execute({
      workspaceId: 'ws-1',
      ...makeRequest({
        allocations: [
          makeAllocation({ categoryId: 'cat-1', percentageOfIncome: 50 }),
          makeAllocation({ categoryId: 'cat-1', percentageOfIncome: 50 }),
        ],
      }),
    });

    expect(result.isLeft()).toBe(true);
    if (result.isLeft()) {
      expect(result.value).toBeInstanceOf(DuplicateBudgetCategoryError);
    }
    expect(repository.saveSnapshot).not.toHaveBeenCalled();
  });

  it('rejects a write targeting a past month', async () => {
    const result = await service.execute({
      workspaceId: 'ws-1',
      ...makeRequest({ effectiveFrom: '2026-10-15' }),
    });

    expect(result.isLeft()).toBe(true);
    if (result.isLeft()) {
      expect(result.value).toBeInstanceOf(HistoricalBudgetImmutableError);
    }
    expect(repository.saveSnapshot).not.toHaveBeenCalled();
  });

  it('rejects a write beyond the next month', async () => {
    const result = await service.execute({
      workspaceId: 'ws-1',
      ...makeRequest({ effectiveFrom: '2027-01-01' }),
    });

    expect(result.isLeft()).toBe(true);
    if (result.isLeft()) {
      expect(result.value).toBeInstanceOf(InvalidBudgetEffectiveDateError);
    }
    expect(repository.saveSnapshot).not.toHaveBeenCalled();
  });

  it('rejects a category from another workspace', async () => {
    repository.findCategoriesByIds.mockResolvedValueOnce([
      category('cat-1', 'ws-2'),
    ]);

    const result = await service.execute({
      workspaceId: 'ws-1',
      ...makeRequest(),
    });

    expect(result.isLeft()).toBe(true);
    if (result.isLeft()) {
      expect(result.value).toBeInstanceOf(ForbiddenBudgetCategoryError);
    }
    expect(repository.saveSnapshot).not.toHaveBeenCalled();
  });

  it('rejects a category that does not exist', async () => {
    repository.findCategoriesByIds.mockResolvedValueOnce([]);

    const result = await service.execute({
      workspaceId: 'ws-1',
      ...makeRequest(),
    });

    expect(result.isLeft()).toBe(true);
    if (result.isLeft()) {
      expect(result.value).toBeInstanceOf(BudgetCategoryNotFoundError);
    }
  });

  it('defaults effectiveFrom to the next month and freezes targets by largest remainder', async () => {
    const result = await service.execute({
      workspaceId: 'ws-1',
      ...makeRequest({
        monthlyIncome: 10_000,
        allocations: [
          makeAllocation({ categoryId: 'cat-1', percentageOfIncome: 33 }),
          makeAllocation({ categoryId: 'cat-2', percentageOfIncome: 33 }),
          makeAllocation({ categoryId: 'cat-3', percentageOfIncome: 34 }),
        ],
      }),
    });

    expect(result.isRight()).toBe(true);
    if (!result.isRight()) return;
    expect(result.value.effectiveFrom).toEqual(NEXT_MONTH_START);

    const saved = savedInputs[0];
    expect(saved.map((allocation) => allocation.targetCents)).toEqual([
      3_300, 3_300, 3_400,
    ]);
    expect(
      saved.reduce((total, allocation) => total + allocation.targetCents, 0),
    ).toBe(10_000);
    expect(saved[0].groupName).toBe('Geral');
    expect(saved[0].categoryOrder).toBe(0);
  });

  it('applies the current month when requested', async () => {
    const result = await service.execute({
      workspaceId: 'ws-1',
      ...makeRequest({ effectiveFrom: '2026-11-20' }),
    });

    expect(result.isRight()).toBe(true);
    if (!result.isRight()) return;
    expect(result.value.effectiveFrom).toEqual(CURRENT_MONTH_START);
  });

  it('maps a unique violation to a conflict error', async () => {
    repository.saveSnapshot.mockRejectedValueOnce(
      new BudgetSnapshotConflictError(),
    );

    const result = await service.execute({
      workspaceId: 'ws-1',
      ...makeRequest(),
    });

    expect(result.isLeft()).toBe(true);
    if (result.isLeft()) {
      expect(result.value).toBeInstanceOf(BudgetSnapshotConflictError);
    }
  });
});
