import { BudgetRepository } from '@modules/budget/repositories/contracts/BudgetRepository';
import { ResolveIncomePrefillService } from '@modules/budget/services/resolve-income-prefill.service';
import { GetWorkspaceTimezoneService } from '@modules/workspace/services/get-workspace-timezone.service';
import { DayJsDateProvider } from '@providers/date/implementations/Dayjs';
import { GetBudgetSetupService } from './get-setup.handler';

const TIMEZONE = 'America/Sao_Paulo';
const NOW = new Date('2026-11-09T12:00:00.000Z');
const NOVEMBER_START = new Date('2026-11-01T03:00:00.000Z');

describe('GetBudgetSetupService', () => {
  let service: GetBudgetSetupService;
  let repository: jest.Mocked<BudgetRepository>;
  let workspaceTimezone: jest.Mocked<GetWorkspaceTimezoneService>;
  let resolveIncomePrefill: jest.Mocked<ResolveIncomePrefillService>;
  let dateProvider: DayJsDateProvider;

  beforeEach(() => {
    repository = {
      resolveSnapshot: jest.fn().mockResolvedValue(null),
      findCategoriesByIds: jest.fn(),
      findCompletedExpenseByCategory: jest.fn(),
      saveSnapshot: jest.fn(),
      findPresetCategories: jest.fn().mockResolvedValue([]),
    } as unknown as jest.Mocked<BudgetRepository>;

    workspaceTimezone = {
      execute: jest.fn().mockResolvedValue(TIMEZONE),
    } as unknown as jest.Mocked<GetWorkspaceTimezoneService>;

    resolveIncomePrefill = {
      execute: jest.fn().mockResolvedValue({ cents: null, source: 'none' }),
    } as unknown as jest.Mocked<ResolveIncomePrefillService>;

    dateProvider = new DayJsDateProvider();
    jest.spyOn(dateProvider, 'now').mockReturnValue(NOW);

    service = new GetBudgetSetupService(
      repository,
      workspaceTimezone,
      resolveIncomePrefill,
      dateProvider,
    );
  });

  afterEach(() => jest.restoreAllMocks());

  it('returns the active monthly income suggestion and the preset split', async () => {
    resolveIncomePrefill.execute.mockResolvedValueOnce({
      cents: 850_000,
      source: 'recurring',
    });
    repository.findPresetCategories.mockResolvedValueOnce([
      { id: 'home', name: 'Moradia' },
      { id: 'leisure', name: 'Lazer' },
    ]);

    const result = await service.execute({ workspaceId: 'ws-1' });

    expect(result.isRight()).toBe(true);
    if (!result.isRight()) return;
    expect(result.value.suggestedIncome).toEqual({
      cents: 850_000,
      source: 'recurring',
    });
    expect(resolveIncomePrefill.execute).toHaveBeenCalledWith({
      workspaceId: 'ws-1',
      timezone: TIMEZONE,
    });
    expect(workspaceTimezone.execute).toHaveBeenCalledTimes(1);
    expect(result.value.allocations).toEqual([
      {
        categoryId: 'home',
        categoryName: 'Moradia',
        percentageOfIncome: 82,
        groupName: 'Custos fixos',
      },
      {
        categoryId: 'leisure',
        categoryName: 'Lazer',
        percentageOfIncome: 18,
        groupName: 'Conforto',
      },
    ]);
  });

  it('includes Investimentos at 25% when the workspace has the category', async () => {
    repository.findPresetCategories.mockResolvedValueOnce([
      { id: 'home', name: 'Moradia' },
      { id: 'food', name: 'Alimentação' },
      { id: 'transport', name: 'Transporte' },
      { id: 'health', name: 'Saúde' },
      { id: 'services', name: 'Serviços' },
      { id: 'leisure', name: 'Lazer' },
      { id: 'shopping', name: 'Compras' },
      { id: 'education', name: 'Educação' },
      { id: 'taxes', name: 'Impostos' },
      { id: 'investments', name: 'Investimentos' },
      { id: 'other', name: 'Outros Gastos' },
    ]);

    const result = await service.execute({ workspaceId: 'ws-1' });

    expect(result.isRight()).toBe(true);
    if (!result.isRight()) return;
    expect(
      result.value.allocations.find(
        (allocation) => allocation.categoryName === 'Investimentos',
      ),
    ).toEqual({
      categoryId: 'investments',
      categoryName: 'Investimentos',
      percentageOfIncome: 25,
      groupName: 'Investimentos',
    });
    expect(
      result.value.allocations.find(
        (allocation) => allocation.categoryName === 'Impostos',
      ),
    ).toEqual({
      categoryId: 'taxes',
      categoryName: 'Impostos',
      percentageOfIncome: 2,
      groupName: 'Impostos',
    });
    expect(
      result.value.allocations.reduce(
        (total, allocation) => total + allocation.percentageOfIncome,
        0,
      ),
    ).toBe(100);
    expect(
      new Set(
        result.value.allocations.map((allocation) => allocation.groupName),
      ),
    ).toEqual(
      new Set([
        'Custos fixos',
        'Conforto',
        'Conhecimento',
        'Impostos',
        'Investimentos',
        'Outros',
      ]),
    );
  });

  it('omits Investimentos when the workspace does not have the category', async () => {
    repository.findPresetCategories.mockResolvedValueOnce([
      { id: 'home', name: 'Moradia' },
      { id: 'food', name: 'Alimentação' },
    ]);

    const result = await service.execute({ workspaceId: 'ws-1' });

    expect(result.isRight()).toBe(true);
    if (!result.isRight()) return;
    expect(
      result.value.allocations.map((allocation) => allocation.categoryName),
    ).not.toContain('Investimentos');
  });

  it('presets the percentage mode when there is no snapshot', async () => {
    const result = await service.execute({ workspaceId: 'ws-1' });

    expect(result.isRight()).toBe(true);
    if (!result.isRight()) return;
    expect(result.value.mode).toBe('percentage');
    expect(repository.resolveSnapshot).toHaveBeenCalledWith(
      'ws-1',
      NOVEMBER_START,
    );
  });

  it('presets the mode of the current snapshot', async () => {
    repository.resolveSnapshot.mockResolvedValueOnce({
      id: 'budget-1',
      workspaceId: 'ws-1',
      effectiveFrom: NOVEMBER_START,
      monthlyIncome: 100_000,
      mode: 'fixed',
      allocations: [],
    });

    const result = await service.execute({ workspaceId: 'ws-1' });

    expect(result.isRight()).toBe(true);
    if (!result.isRight()) return;
    expect(result.value.mode).toBe('fixed');
    expect(result.value.suggestedIncome).toEqual({
      cents: null,
      source: 'none',
    });
  });
});
