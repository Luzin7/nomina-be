import { CacheProvider } from '@infra/cache/contracts/CacheProvider';
import { TopExpensesByCategory } from '@modules/transaction/valueObjects/TopExpensesByCategory';
import { TransactionRepository } from '@modules/transaction/repositories/contracts/TransactionRepository';
import { GetWorkspaceTimezoneService } from '@modules/workspace/services/get-workspace-timezone.service';
import { DateProvider } from '@providers/date/contracts/DateProvider';
import { DayJsDateProvider } from '@providers/date/implementations/Dayjs';
import { LEDGER_CACHE_TTL_SECONDS } from '@shared/cache/report-cache';
import { InMemoryCacheProvider } from '@shared/cache/test-helpers/in-memory-cache';
import { GetExpensesByCategoryService } from './get-expenses-by-category.handler';

const START = new Date('2026-09-01T03:00:00.000Z');
const END = new Date('2026-09-30T02:59:59.999Z');
const NOW = new Date('2026-09-10T12:00:00.000Z');

function makeRequest(overrides = {}) {
  return { workspaceId: 'ws-1', month: 9, year: 2026, limit: 5, ...overrides };
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
      now: jest.fn().mockReturnValue(NOW),
      format: jest.fn().mockReturnValue('2026-09'),
      startOfMonth: jest.fn().mockReturnValue(START),
      endOfMonth: jest.fn().mockReturnValue(END),
    } as unknown as jest.Mocked<DateProvider>;

    cache = {
      get: jest.fn().mockResolvedValue(null),
      set: jest.fn().mockResolvedValue(true),
      readCounter: jest.fn().mockResolvedValue(7),
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
        isCurrentMonth: true,
      },
    );
  });

  it('passes the requested limit to the repository as pageSize', async () => {
    transactionRepository.getTopExpensesByCategory.mockResolvedValue({
      expenses: [],
      totalExpense: 0,
    });

    await service.execute(makeRequest({ limit: 50 }));

    expect(transactionRepository.getTopExpensesByCategory).toHaveBeenCalledWith(
      expect.objectContaining({ pageSize: 50 }),
    );
  });

  it('keys the cache by limit', async () => {
    transactionRepository.getTopExpensesByCategory.mockResolvedValue({
      expenses: [],
      totalExpense: 0,
    });

    await service.execute(makeRequest({ limit: 50 }));

    expect(cache.get).toHaveBeenCalledWith(
      'report:expenses-by-category:v6:ws-1:g7:c7:2026-9:2026-09:50',
    );
  });

  it('keeps hidden categories for a historical month', async () => {
    transactionRepository.getTopExpensesByCategory.mockResolvedValue({
      expenses: [],
      totalExpense: 0,
    });

    await service.execute(makeRequest({ month: 8 }));

    expect(transactionRepository.getTopExpensesByCategory).toHaveBeenCalledWith(
      expect.objectContaining({ isCurrentMonth: false }),
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
      'report:expenses-by-category:v6:ws-1:g7:c7:2026-9:2026-09:5',
      JSON.stringify(result),
      LEDGER_CACHE_TTL_SECONDS,
    );
  });

  it('skips the cache entirely when the generation is unreadable', async () => {
    cache.readCounter.mockResolvedValue(null);
    transactionRepository.getTopExpensesByCategory.mockResolvedValue({
      expenses: [],
      totalExpense: 0,
    });

    await service.execute(makeRequest());

    expect(cache.get).not.toHaveBeenCalled();
    expect(cache.set).not.toHaveBeenCalled();
    expect(transactionRepository.getTopExpensesByCategory).toHaveBeenCalled();
  });

  it('misses on the next read when a write bumped the generation during compute', async () => {
    cache.readCounter
      .mockResolvedValueOnce(7)
      .mockResolvedValueOnce(7)
      .mockResolvedValueOnce(8)
      .mockResolvedValueOnce(8);
    transactionRepository.getTopExpensesByCategory.mockResolvedValue({
      expenses: [],
      totalExpense: 0,
    });

    await service.execute(makeRequest());
    await service.execute(makeRequest());

    expect(cache.set).toHaveBeenCalledWith(
      'report:expenses-by-category:v6:ws-1:g7:c7:2026-9:2026-09:5',
      expect.any(String),
      LEDGER_CACHE_TTL_SECONDS,
    );
    expect(cache.get).toHaveBeenLastCalledWith(
      'report:expenses-by-category:v6:ws-1:g8:c8:2026-9:2026-09:5',
    );
  });
});

describe('GetExpensesByCategoryService today-dependent key', () => {
  const SAO_PAULO = 'America/Sao_Paulo';

  it.each([
    {
      case: 'month rollover in UTC',
      before: '2026-09-30T12:00:00.000Z',
      after: '2026-10-01T12:00:00.000Z',
    },
    {
      case: 'local midnight month rollover inside one UTC day',
      before: '2026-10-01T02:30:00.000Z',
      after: '2026-10-01T03:30:00.000Z',
    },
  ])('recomputes isCurrentMonth after $case', async ({ before, after }) => {
    const transactionRepository = {
      getTopExpensesByCategory: jest
        .fn()
        .mockResolvedValue({ expenses: [], totalExpense: 0 }),
    } as unknown as jest.Mocked<TransactionRepository>;
    const workspaceTimezone = {
      execute: jest.fn().mockResolvedValue(SAO_PAULO),
    } as unknown as jest.Mocked<GetWorkspaceTimezoneService>;
    const dateProvider = new DayJsDateProvider();
    const now = jest.spyOn(dateProvider, 'now');
    const service = new GetExpensesByCategoryService(
      transactionRepository,
      workspaceTimezone,
      dateProvider,
      new InMemoryCacheProvider(),
    );

    now.mockReturnValue(new Date(before));
    await service.execute(makeRequest());
    now.mockReturnValue(new Date(after));
    await service.execute(makeRequest());

    expect(
      transactionRepository.getTopExpensesByCategory.mock.calls.map(
        ([input]) => input.isCurrentMonth,
      ),
    ).toEqual([true, false]);
  });
});
