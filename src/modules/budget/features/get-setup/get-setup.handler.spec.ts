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
        percentageOfIncome: 83,
        groupName: 'Custos fixos',
      },
      {
        categoryId: 'leisure',
        categoryName: 'Lazer',
        percentageOfIncome: 17,
        groupName: 'Conforto',
      },
    ]);
  });
});
