import { CacheProvider } from '@infra/cache/contracts/CacheProvider';
import { TopExpensesByCategory } from '@modules/transaction/valueObjects/TopExpensesByCategory';
import { TransactionRepository } from '@modules/transaction/repositories/contracts/TransactionRepository';
import { GetWorkspaceTimezoneService } from '@modules/workspace/services/get-workspace-timezone.service';
import { DateProvider } from '@providers/date/contracts/DateProvider';
import { GetExpensesByCategoryService } from './get-expenses-by-category.handler';

const START = new Date('2026-09-01T03:00:00.000Z');
const END = new Date('2026-09-30T02:59:59.999Z');

function makeRequest(overrides = {}) {
  return { workspaceId: 'ws-1', month: 9, year: 2026, ...overrides };
}

function makeExpense(categoryId: string, categoryName: string, amount: number) {
  return new TopExpensesByCategory({ categoryId, categoryName, amount });
}

describe('GetExpensesByCategoryService', () => {
  let service: GetExpensesByCategoryService;
  let transactionRepository: jest.Mocked<TransactionRepository>;
  let workspaceTimezone: jest.Mocked<GetWorkspaceTimezoneService>;
  let dateProvider: jest.Mocked<DateProvider>;
  let cache: jest.Mocked<CacheProvider>;

  beforeEach(() => {
    transactionRepository = {
      getTopExpensesByCategory: jest.fn(),
    } as unknown as jest.Mocked<TransactionRepository>;

    workspaceTimezone = {
      execute: jest.fn().mockResolvedValue('America/Sao_Paulo'),
    } as unknown as jest.Mocked<GetWorkspaceTimezoneService>;

    dateProvider = {
      startOfMonth: jest.fn().mockReturnValue(START),
      endOfMonth: jest.fn().mockReturnValue(END),
    } as unknown as jest.Mocked<DateProvider>;

    cache = {
      get: jest.fn().mockResolvedValue(null),
      set: jest.fn().mockResolvedValue(true),
    } as unknown as jest.Mocked<CacheProvider>;

    service = new GetExpensesByCategoryService(
      transactionRepository,
      workspaceTimezone,
      dateProvider,
      cache,
    );
  });

  afterEach(() => jest.clearAllMocks());

  it('returns cached result without touching the repository', async () => {
    const cached = { expenses: [], totalExpense: 0 };
    cache.get.mockResolvedValue(JSON.stringify(cached));

    await expect(service.execute(makeRequest())).resolves.toEqual(cached);
    expect(
      transactionRepository.getTopExpensesByCategory,
    ).not.toHaveBeenCalled();
    expect(workspaceTimezone.execute).not.toHaveBeenCalled();
  });

  it('queries the repository with named params in workspace timezone', async () => {
    transactionRepository.getTopExpensesByCategory.mockResolvedValue({
      expenses: [],
      totalExpense: 0,
    });

    await service.execute(makeRequest());

    expect(dateProvider.startOfMonth).toHaveBeenCalledWith(
      '2026-09-01',
      'America/Sao_Paulo',
    );
    expect(dateProvider.endOfMonth).toHaveBeenCalledWith(
      '2026-09-01',
      'America/Sao_Paulo',
    );
    expect(transactionRepository.getTopExpensesByCategory).toHaveBeenCalledWith(
      {
        workspaceId: 'ws-1',
        startDate: START,
        endDate: END,
        pageSize: 5,
      },
    );
  });

  it('maps value objects to a plain result and caches it', async () => {
    transactionRepository.getTopExpensesByCategory.mockResolvedValue({
      expenses: [makeExpense('cat-a', 'Petshop', 6000)],
      totalExpense: 10000,
    });

    const result = await service.execute(makeRequest());

    expect(result).toEqual({
      expenses: [
        { categoryId: 'cat-a', categoryName: 'Petshop', amount: 6000 },
      ],
      totalExpense: 10000,
    });
    expect(cache.set).toHaveBeenCalledWith(
      'report:expenses-by-category:v2:ws-1:2026-9',
      JSON.stringify(result),
      300,
    );
  });
});
