import { CacheProvider } from '@infra/cache/contracts/CacheProvider';
import { DrizzleService } from '@infra/databases/drizzle/drizzle.service';
import { GetWorkspaceTimezoneService } from '@modules/workspace/services/get-workspace-timezone.service';
import { DateProvider } from '@providers/date/contracts/DateProvider';
import { LEDGER_CACHE_TTL_SECONDS } from '@shared/cache/report-cache';
import { CashFlowEvolutionService } from './cash-flow-evolution.handler';

const CACHE_KEY = 'report:cash-flow-evolution:v3:ws-1:g7:2026-09-01:2026-09-30';

function makeRequest(overrides = {}) {
  return {
    workspaceId: 'ws-1',
    startDate: '2026-09-01',
    endDate: '2026-09-30',
    ...overrides,
  };
}

describe('CashFlowEvolutionService', () => {
  let service: CashFlowEvolutionService;
  let select: jest.Mock;
  let cache: jest.Mocked<CacheProvider>;
  let workspaceTimezone: jest.Mocked<GetWorkspaceTimezoneService>;
  let dateProvider: jest.Mocked<DateProvider>;

  function makeQueryBuilder(rows: unknown[]): unknown {
    const builder: unknown = new Proxy(() => undefined, {
      get: (_target, property) =>
        property === 'then'
          ? (resolve: (value: unknown[]) => void) => resolve(rows)
          : () => builder,
    });
    return builder;
  }

  beforeEach(() => {
    select = jest
      .fn()
      .mockReturnValue(
        makeQueryBuilder([
          { date: '2026-09-02', income: 5000, expense: 2000, balance: 3000 },
        ]),
      );
    cache = {
      get: jest.fn().mockResolvedValue(null),
      set: jest.fn().mockResolvedValue(true),
      readCounter: jest.fn().mockResolvedValue(7),
    } as unknown as jest.Mocked<CacheProvider>;
    workspaceTimezone = {
      execute: jest.fn().mockResolvedValue('America/Sao_Paulo'),
    } as unknown as jest.Mocked<GetWorkspaceTimezoneService>;
    dateProvider = {
      startOfDay: jest.fn().mockReturnValue(new Date()),
      endOfDay: jest.fn().mockReturnValue(new Date()),
    } as unknown as jest.Mocked<DateProvider>;

    service = new CashFlowEvolutionService(
      { db: { select } } as unknown as DrizzleService,
      dateProvider,
      workspaceTimezone,
      cache,
    );
  });

  it('returns the cached result without database or timezone lookups', async () => {
    const cached = [{ date: '2026-09-02', income: 1, expense: 0, balance: 1 }];
    cache.get.mockResolvedValue(JSON.stringify(cached));

    await expect(service.execute(makeRequest())).resolves.toEqual(cached);
    expect(cache.get).toHaveBeenCalledWith(CACHE_KEY);
    expect(select).not.toHaveBeenCalled();
    expect(workspaceTimezone.execute).not.toHaveBeenCalled();
  });

  it('stores the computed result with the report TTL on a miss', async () => {
    const result = await service.execute(makeRequest());

    expect(result).toEqual([
      { date: '2026-09-02', income: 50, expense: 20, balance: 30 },
    ]);
    expect(cache.set).toHaveBeenCalledWith(
      CACHE_KEY,
      JSON.stringify(result),
      LEDGER_CACHE_TTL_SECONDS,
    );
  });

  it('queries the database without caching when the generation is unreadable', async () => {
    cache.readCounter.mockResolvedValue(null);

    const result = await service.execute(makeRequest());

    expect(result).toHaveLength(1);
    expect(cache.get).not.toHaveBeenCalled();
    expect(cache.set).not.toHaveBeenCalled();
  });
});
