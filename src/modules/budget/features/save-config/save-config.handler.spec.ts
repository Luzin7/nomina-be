import {
  BudgetRepository,
  SaveBudgetSnapshotInput,
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
    mode: 'percentage',
    monthlyIncome: 10_000,
    allocations: [makeAllocation()],
    ...overrides,
  } as SaveBudgetConfigRequest;
}

function category(
  id: string,
  workspaceId: string | null = 'ws-1',
  isHidden = false,
) {
  return { id, name: `Category ${id}`, workspaceId, isHidden };
}

function makeSnapshot(categoryIds: string[]) {
  return {
    id: 'budget-0',
    workspaceId: 'ws-1',
    effectiveFrom: CURRENT_MONTH_START,
    monthlyIncome: 10_000,
    mode: 'percentage' as const,
    allocations: categoryIds.map((categoryId, index) => ({
      id: `alloc-${index}`,
      categoryId,
      categoryName: null,
      groupName: 'Geral',
      groupOrder: 0,
      categoryOrder: index,
      percentageOfIncome: 100,
      targetCents: 10_000,
    })),
  };
}

describe('SaveBudgetConfigService', () => {
  let service: SaveBudgetConfigService;
  let repository: jest.Mocked<BudgetRepository>;
  let workspaceTimezone: jest.Mocked<GetWorkspaceTimezoneService>;
  let dateProvider: DayJsDateProvider;
  let savedInputs: SaveBudgetSnapshotInput[];

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
        savedInputs.push(input);
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

  it('rejects hidden category missing from snapshot', async () => {
    repository.findCategoriesByIds.mockResolvedValueOnce([
      category('cat-1', 'ws-1', true),
    ]);
    repository.resolveSnapshot.mockResolvedValueOnce(makeSnapshot(['cat-2']));

    const result = await service.execute({
      workspaceId: 'ws-1',
      ...makeRequest(),
    });

    expect(result.isLeft()).toBe(true);
    if (result.isLeft()) {
      expect(result.value).toBeInstanceOf(HiddenBudgetCategoryError);
    }
    expect(repository.saveSnapshot).not.toHaveBeenCalled();
  });

  it('rejects a hidden category when no snapshot exists yet', async () => {
    repository.findCategoriesByIds.mockResolvedValueOnce([
      category('cat-1', 'ws-1', true),
    ]);
    repository.resolveSnapshot.mockResolvedValueOnce(null);

    const result = await service.execute({
      workspaceId: 'ws-1',
      ...makeRequest(),
    });

    expect(result.isLeft()).toBe(true);
    if (result.isLeft()) {
      expect(result.value).toBeInstanceOf(HiddenBudgetCategoryError);
    }
  });

  it('accepts hidden category present in snapshot', async () => {
    repository.findCategoriesByIds.mockResolvedValueOnce([
      category('cat-1', 'ws-1', true),
    ]);
    repository.resolveSnapshot.mockResolvedValueOnce(makeSnapshot(['cat-1']));

    const result = await service.execute({
      workspaceId: 'ws-1',
      ...makeRequest({ effectiveFrom: CURRENT_MONTH_START.toISOString() }),
    });

    expect(result.isRight()).toBe(true);
    expect(repository.resolveSnapshot).toHaveBeenCalledWith(
      'ws-1',
      CURRENT_MONTH_START,
    );
  });

  it('does not load the snapshot when no category is hidden', async () => {
    await service.execute({ workspaceId: 'ws-1', ...makeRequest() });

    expect(repository.resolveSnapshot).not.toHaveBeenCalled();
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

    const saved = savedInputs[0].allocations;
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

  it('maps a category removed before the write to a forbidden error', async () => {
    repository.saveSnapshot.mockRejectedValueOnce(
      new ForbiddenBudgetCategoryError(),
    );

    const result = await service.execute({
      workspaceId: 'ws-1',
      ...makeRequest(),
    });

    expect(result.isLeft()).toBe(true);
    if (result.isLeft()) {
      expect(result.value).toBeInstanceOf(ForbiddenBudgetCategoryError);
    }
  });

  it('persists fixed targets verbatim and derives the percentages', async () => {
    const result = await service.execute({
      workspaceId: 'ws-1',
      ...makeRequest({
        mode: 'fixed',
        monthlyIncome: 100_000,
        allocations: [
          { categoryId: 'cat-1', targetCents: 30_000 },
          { categoryId: 'cat-2', targetCents: 50_500 },
        ],
      }),
    });

    expect(result.isRight()).toBe(true);
    if (!result.isRight()) return;
    expect(result.value.mode).toBe('fixed');
    expect(result.value.monthlyIncomeCents).toBe(100_000);
    expect(result.value.totalTargetCents).toBe(80_500);
    expect(result.value.unallocatedIncomeCents).toBe(19_500);
    expect(result.value.allocationState).toBe('under');

    const saved = savedInputs[0];
    expect(saved.mode).toBe('fixed');
    expect(
      saved.allocations.map((allocation) => allocation.targetCents),
    ).toEqual([30_000, 50_500]);
    expect(
      saved.allocations.map((allocation) => allocation.percentageOfIncome),
    ).toEqual([30, 51]);
  });

  it('accepts a fixed plan above the declared income', async () => {
    const result = await service.execute({
      workspaceId: 'ws-1',
      ...makeRequest({
        mode: 'fixed',
        monthlyIncome: 100_000,
        allocations: [
          { categoryId: 'cat-1', targetCents: 70_000 },
          { categoryId: 'cat-2', targetCents: 60_000 },
        ],
      }),
    });

    expect(result.isRight()).toBe(true);
    if (!result.isRight()) return;
    expect(result.value.monthlyIncomeCents).toBe(100_000);
    expect(result.value.totalTargetCents).toBe(130_000);
    expect(result.value.monthlyIncomeCents).not.toBe(
      result.value.totalTargetCents,
    );
    expect(result.value.unallocatedIncomeCents).toBe(0);
    expect(result.value.allocationState).toBe('over');
  });

  it('accepts a fixed plan with all targets at zero', async () => {
    const result = await service.execute({
      workspaceId: 'ws-1',
      ...makeRequest({
        mode: 'fixed',
        allocations: [{ categoryId: 'cat-1', targetCents: 0 }],
      }),
    });

    expect(result.isRight()).toBe(true);
    if (!result.isRight()) return;
    expect(result.value.totalTargetCents).toBe(0);
    expect(result.value.unallocatedIncomeCents).toBe(10_000);
    expect(result.value.allocationState).toBe('under');
  });

  it('rejects a percentage payload that also carries fixed targets', async () => {
    const result = await service.execute({
      workspaceId: 'ws-1',
      ...makeRequest({
        allocations: [
          {
            categoryId: 'cat-1',
            percentageOfIncome: 100,
            targetCents: 10_000,
          },
        ],
      }),
    });

    expect(result.isLeft()).toBe(true);
    if (result.isLeft()) {
      expect(result.value).toBeInstanceOf(MixedBudgetModeFieldsError);
    }
    expect(repository.saveSnapshot).not.toHaveBeenCalled();
  });

  it('rejects a fixed payload that also carries percentages', async () => {
    const result = await service.execute({
      workspaceId: 'ws-1',
      ...makeRequest({
        mode: 'fixed',
        allocations: [
          {
            categoryId: 'cat-1',
            percentageOfIncome: 100,
            targetCents: 10_000,
          },
        ],
      }),
    });

    expect(result.isLeft()).toBe(true);
    if (result.isLeft()) {
      expect(result.value).toBeInstanceOf(MixedBudgetModeFieldsError);
    }
    expect(repository.saveSnapshot).not.toHaveBeenCalled();
  });

  it('rejects a fixed payload without targets', async () => {
    const result = await service.execute({
      workspaceId: 'ws-1',
      ...makeRequest({
        mode: 'fixed',
        allocations: [{ categoryId: 'cat-1' }],
      }),
    });

    expect(result.isLeft()).toBe(true);
    if (result.isLeft()) {
      expect(result.value).toBeInstanceOf(MixedBudgetModeFieldsError);
    }
  });

  it('rejects a percentage payload without percentages', async () => {
    const result = await service.execute({
      workspaceId: 'ws-1',
      ...makeRequest({
        allocations: [{ categoryId: 'cat-1' }],
      }),
    });

    expect(result.isLeft()).toBe(true);
    if (result.isLeft()) {
      expect(result.value).toBeInstanceOf(MixedBudgetModeFieldsError);
    }
  });

  it.each([-1, 1.5])('rejects a target of %s cents', async (targetCents) => {
    const result = await service.execute({
      workspaceId: 'ws-1',
      ...makeRequest({
        mode: 'fixed',
        allocations: [{ categoryId: 'cat-1', targetCents }],
      }),
    });

    expect(result.isLeft()).toBe(true);
    if (result.isLeft()) {
      expect(result.value).toBeInstanceOf(InvalidBudgetTargetError);
    }
    expect(repository.saveSnapshot).not.toHaveBeenCalled();
  });

  it('rejects a duplicated category in fixed mode', async () => {
    const result = await service.execute({
      workspaceId: 'ws-1',
      ...makeRequest({
        mode: 'fixed',
        allocations: [
          { categoryId: 'cat-1', targetCents: 10_000 },
          { categoryId: 'cat-1', targetCents: 20_000 },
        ],
      }),
    });

    expect(result.isLeft()).toBe(true);
    if (result.isLeft()) {
      expect(result.value).toBeInstanceOf(DuplicateBudgetCategoryError);
    }
  });
});
