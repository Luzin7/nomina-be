import { BudgetRepository } from '@modules/budget/repositories/contracts/BudgetRepository';
import { GetBudgetSetupService } from './get-setup.handler';

describe('GetBudgetSetupService', () => {
  let service: GetBudgetSetupService;
  let repository: jest.Mocked<BudgetRepository>;

  beforeEach(() => {
    repository = {
      resolveSnapshot: jest.fn(),
      findCategoriesByIds: jest.fn(),
      findCompletedExpenseByCategory: jest.fn(),
      saveSnapshot: jest.fn(),
      findMonthlyIncomeSuggestion: jest.fn().mockResolvedValue(0),
      findPresetCategories: jest.fn().mockResolvedValue([]),
    } as unknown as jest.Mocked<BudgetRepository>;

    service = new GetBudgetSetupService(repository);
  });

  afterEach(() => jest.clearAllMocks());

  it('returns the active monthly income suggestion and the preset split', async () => {
    repository.findMonthlyIncomeSuggestion.mockResolvedValueOnce(850_000);
    repository.findPresetCategories.mockResolvedValueOnce([
      { id: 'home', name: 'Moradia' },
      { id: 'leisure', name: 'Lazer' },
    ]);

    const result = await service.execute({ workspaceId: 'ws-1' });

    expect(result.isRight()).toBe(true);
    if (!result.isRight()) return;
    expect(result.value.suggestedIncome).toBe(850_000);
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
      groupName: 'Custos fixos',
    });
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
});
