import { TransactionRepository } from '@modules/transaction/repositories/contracts/TransactionRepository';
import { GetWorkspaceTimezoneService } from '@modules/workspace/services/get-workspace-timezone.service';
import { DayJsDateProvider } from '@providers/date/implementations/Dayjs';
import { LEDGER_LIVE_CACHE_TTL_SECONDS } from '@shared/cache/report-cache';
import { InMemoryCacheProvider } from '@shared/cache/test-helpers/in-memory-cache';
import { ListTransactionTotalsService } from './list-transaction-totals.service';

type ServiceRequest = Parameters<
  typeof ListTransactionTotalsService.prototype.execute
>[0];

const TOTALS = {
  count: 3,
  incomeCents: 1000,
  expenseCents: 400,
  transferCents: 250,
};

function makeRequest(
  overrides: Partial<Record<string, unknown>> = {},
): ServiceRequest {
  return {
    sub: 'user-1',
    workspaceId: 'ws-1',
    ...overrides,
  } as ServiceRequest;
}

function makeTimezoneService(
  timezone: string,
): jest.Mocked<GetWorkspaceTimezoneService> {
  return {
    execute: jest.fn().mockResolvedValue(timezone),
  } as unknown as jest.Mocked<GetWorkspaceTimezoneService>;
}

describe('ListTransactionTotalsService', () => {
  let transactionRepository: jest.Mocked<
    Pick<TransactionRepository, 'sumTransactionsByWorkspaceId'>
  >;
  let cache: InMemoryCacheProvider;

  function makeService(timezone = 'UTC') {
    return new ListTransactionTotalsService(
      transactionRepository as unknown as TransactionRepository,
      new DayJsDateProvider(),
      makeTimezoneService(timezone),
      cache,
    );
  }

  beforeEach(() => {
    transactionRepository = {
      sumTransactionsByWorkspaceId: jest.fn().mockResolvedValue(TOTALS),
    };
    cache = new InMemoryCacheProvider();
  });

  it('returns the repository totals', async () => {
    const result = await makeService().execute(makeRequest());

    expect(result.isRight()).toBe(true);
    expect(result.value).toEqual(TOTALS);
  });

  it('returns the zero state when no row matches', async () => {
    const zero = {
      count: 0,
      incomeCents: 0,
      expenseCents: 0,
      transferCents: 0,
    };
    transactionRepository.sumTransactionsByWorkspaceId.mockResolvedValue(zero);

    const result = await makeService().execute(makeRequest());

    expect(result.value).toEqual(zero);
  });

  it('forwards the filters to the repository', async () => {
    await makeService().execute(
      makeRequest({
        type: 'EXPENSE',
        categoryId: 'cat-1',
        accountId: 'acc-1',
        title: 'rent',
        status: 'COMPLETED',
      }),
    );

    expect(
      transactionRepository.sumTransactionsByWorkspaceId,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: 'ws-1',
        type: 'EXPENSE',
        categoryId: 'cat-1',
        accountId: 'acc-1',
        title: 'rent',
        status: 'COMPLETED',
      }),
    );
  });

  it.each([
    ['UTC', '2026-11-15T23:30:00.000Z', '2026-11-16T00:30:00.000Z'],
    [
      'America/Sao_Paulo',
      '2026-11-16T02:30:00.000Z',
      '2026-11-16T03:30:00.000Z',
    ],
  ])(
    'cuts endDate at the end of the local day in %s',
    async (timezone, inside, outside) => {
      await makeService(timezone).execute(
        makeRequest({ endDate: '2026-11-15' }),
      );

      const { endDate } =
        transactionRepository.sumTransactionsByWorkspaceId.mock.calls[0][0];
      expect(new Date(inside).getTime()).toBeLessThanOrEqual(
        endDate!.getTime(),
      );
      expect(new Date(outside).getTime()).toBeGreaterThan(endDate!.getTime());
    },
  );

  it('serves the second identical call from cache', async () => {
    const service = makeService();

    await service.execute(makeRequest({ type: 'INCOME' }));
    await service.execute(makeRequest({ type: 'INCOME' }));

    expect(
      transactionRepository.sumTransactionsByWorkspaceId,
    ).toHaveBeenCalledTimes(1);
  });

  it('does not share cache between different filters', async () => {
    const service = makeService();

    await service.execute(makeRequest({ type: 'INCOME' }));
    await service.execute(makeRequest({ type: 'EXPENSE' }));

    expect(
      transactionRepository.sumTransactionsByWorkspaceId,
    ).toHaveBeenCalledTimes(2);
  });

  it('keys the entry by workspace, ledger generation and filters with the live ttl', async () => {
    await makeService().execute(makeRequest());

    const [[key]] = [...cache.ttls.entries()];
    expect(key).toMatch(/^transaction:list-totals:v1:ws-1:g\d+:[0-9a-f]+$/);
    expect(cache.ttls.get(key)).toBe(LEDGER_LIVE_CACHE_TTL_SECONDS);
  });
});
