import { CacheProvider } from '@infra/cache/contracts/CacheProvider';
import { DrizzleService } from '@infra/databases/drizzle/drizzle.service';
import { GetWorkspaceTimezoneService } from '@modules/workspace/services/get-workspace-timezone.service';
import { DayJsDateProvider } from '@providers/date/implementations/Dayjs';
import { LEDGER_CACHE_TTL_SECONDS } from '@shared/cache/report-cache';
import {
  BalanceEvolutionService,
  buildDailySummary,
  buildNetWorthEvolution,
  calculateNetPeriodEffect,
  resolveGeneralType,
  resolveInvestmentType,
  type PeriodRow,
} from './get-balance-evolution.handler';

const dateProvider = new DayJsDateProvider();
const START = new Date('2026-09-01T00:00:00.000Z');
const END = new Date('2026-09-02T23:59:59.999Z');

describe('resolveGeneralType', () => {
  it('classifies invoice payment as expense', () => {
    expect(resolveGeneralType('TRANSFER', 'CHECKING', 'CREDIT_CARD')).toBe(
      'EXPENSE',
    );
  });

  it('classifies transfer to investment as expense', () => {
    expect(resolveGeneralType('TRANSFER', 'CHECKING', 'INVESTMENT')).toBe(
      'EXPENSE',
    );
  });

  it('classifies transfer from investment as income', () => {
    expect(resolveGeneralType('TRANSFER', 'INVESTMENT', 'CHECKING')).toBe(
      'INCOME',
    );
  });

  it('keeps unrelated transfers untouched', () => {
    expect(resolveGeneralType('TRANSFER', 'CHECKING', 'CHECKING')).toBe(
      'TRANSFER',
    );
  });
});

describe('resolveInvestmentType', () => {
  it('classifies transfer to investment as income', () => {
    expect(resolveInvestmentType('TRANSFER', 'CHECKING', 'INVESTMENT')).toBe(
      'INCOME',
    );
  });

  it('classifies transfer from investment as expense', () => {
    expect(resolveInvestmentType('TRANSFER', 'INVESTMENT', 'CHECKING')).toBe(
      'EXPENSE',
    );
  });
});

describe('calculateNetPeriodEffect', () => {
  it('nets income minus expense', () => {
    const period: PeriodRow[] = [
      {
        type: 'INCOME',
        sourceType: 'CHECKING',
        destType: null,
        amount: 5000,
        date: START,
      },
      {
        type: 'EXPENSE',
        sourceType: 'CHECKING',
        destType: null,
        amount: 2000,
        date: START,
      },
    ];

    expect(calculateNetPeriodEffect(period, resolveGeneralType)).toBe(3000);
  });
});

describe('buildDailySummary', () => {
  it('applies opening balance and accumulates period movement per day', () => {
    const result = buildDailySummary({
      opening: [
        {
          type: 'EXPENSE',
          sourceType: 'CHECKING',
          destType: null,
          amount: 1000,
        },
      ],
      period: [
        {
          type: 'INCOME',
          sourceType: 'CHECKING',
          destType: null,
          amount: 5000,
          date: new Date('2026-09-01T12:00:00.000Z'),
        },
        {
          type: 'EXPENSE',
          sourceType: 'CHECKING',
          destType: null,
          amount: 2000,
          date: new Date('2026-09-02T12:00:00.000Z'),
        },
      ],
      resolve: resolveGeneralType,
      dateProvider,
      timezone: 'UTC',
      startDate: START,
      endDate: END,
    });

    expect(result).toEqual([
      { date: '2026-09-01', income: 50, expense: 0, balance: 40 },
      { date: '2026-09-02', income: 0, expense: 20, balance: 20 },
    ]);
  });

  it('ignores opening balance when explicit start balance is provided', () => {
    const result = buildDailySummary({
      opening: [
        {
          type: 'EXPENSE',
          sourceType: 'CHECKING',
          destType: null,
          amount: 9999,
        },
      ],
      period: [],
      resolve: resolveGeneralType,
      dateProvider,
      timezone: 'UTC',
      startDate: START,
      endDate: START,
      explicitStartBalance: 100,
    });

    expect(result).toEqual([
      { date: '2026-09-01', income: 0, expense: 0, balance: 1 },
    ]);
  });

  it('anchors the final balance to the real account balance', () => {
    const period: PeriodRow[] = [
      {
        type: 'INCOME',
        sourceType: 'CHECKING',
        destType: null,
        amount: 5000,
        date: new Date('2026-09-01T12:00:00.000Z'),
      },
      {
        type: 'EXPENSE',
        sourceType: 'CHECKING',
        destType: null,
        amount: 2000,
        date: new Date('2026-09-02T12:00:00.000Z'),
      },
    ];
    const totalGeneralBalance = 2999;
    const explicitStartBalance =
      totalGeneralBalance -
      calculateNetPeriodEffect(period, resolveGeneralType);

    const result = buildDailySummary({
      opening: [],
      period,
      resolve: resolveGeneralType,
      dateProvider,
      timezone: 'UTC',
      startDate: START,
      endDate: END,
      explicitStartBalance,
    });

    expect(result.at(-1)?.balance).toBe(29.99);
  });
});

describe('buildNetWorthEvolution', () => {
  const baseParams = {
    dateProvider,
    timezone: 'UTC',
    startDate: START,
    endDate: END,
  };

  it('anchors the last day on the current net worth', () => {
    const result = buildNetWorthEvolution({
      ...baseParams,
      period: [
        {
          type: 'INCOME',
          sourceType: 'CHECKING',
          destType: null,
          amount: 5000,
          date: new Date('2026-09-01T12:00:00.000Z'),
        },
        {
          type: 'EXPENSE',
          sourceType: 'CREDIT_CARD',
          destType: null,
          amount: 2000,
          date: new Date('2026-09-02T12:00:00.000Z'),
        },
      ],
      currentNetWorth: 10000,
    });

    expect(result).toEqual([
      { date: '2026-09-01', income: 50, expense: 0, balance: 120 },
      { date: '2026-09-02', income: 0, expense: 20, balance: 100 },
    ]);
  });

  it('keeps a flat line at the current net worth when nothing happened', () => {
    const result = buildNetWorthEvolution({
      ...baseParams,
      period: [],
      currentNetWorth: -2500,
    });

    expect(result).toEqual([
      { date: '2026-09-01', income: 0, expense: 0, balance: -25 },
      { date: '2026-09-02', income: 0, expense: 0, balance: -25 },
    ]);
  });
});

describe('BalanceEvolutionService cache', () => {
  let service: BalanceEvolutionService;
  let cache: jest.Mocked<CacheProvider>;
  let workspaceTimezone: jest.Mocked<GetWorkspaceTimezoneService>;
  let nowSpy: jest.SpyInstance;
  const request = {
    workspaceId: 'ws-1',
    period: '7d',
  } as Parameters<BalanceEvolutionService['execute']>[0];

  function makeEmptyQueryBuilder(): unknown {
    const builder: unknown = new Proxy(() => undefined, {
      get: (_target, property) =>
        property === 'then'
          ? (resolve: (rows: unknown[]) => void) => resolve([])
          : () => builder,
    });
    return builder;
  }

  beforeEach(() => {
    const drizzle = {
      db: { select: () => makeEmptyQueryBuilder() },
    } as unknown as DrizzleService;
    cache = {
      get: jest.fn().mockResolvedValue(null),
      set: jest.fn().mockResolvedValue(true),
      readCounter: jest.fn().mockResolvedValue(7),
    } as unknown as jest.Mocked<CacheProvider>;
    workspaceTimezone = {
      execute: jest.fn().mockResolvedValue('America/Sao_Paulo'),
    } as unknown as jest.Mocked<GetWorkspaceTimezoneService>;
    nowSpy = jest.spyOn(dateProvider, 'now');

    service = new BalanceEvolutionService(
      drizzle,
      cache,
      workspaceTimezone,
      dateProvider,
    );
  });

  afterEach(() => nowSpy.mockRestore());

  it('keys the cache by the local day before the midnight boundary', async () => {
    nowSpy.mockReturnValue(new Date('2026-11-04T02:59:00.000Z'));

    await service.execute(request);

    expect(cache.get).toHaveBeenCalledWith(
      'report:balance-evolution:v4:ws-1:g7:7d:2026-11-03',
    );
  });

  it('keys the cache by the next local day after the midnight boundary', async () => {
    nowSpy.mockReturnValue(new Date('2026-11-04T03:00:00.000Z'));

    await service.execute(request);

    expect(cache.get).toHaveBeenCalledWith(
      'report:balance-evolution:v4:ws-1:g7:7d:2026-11-04',
    );
  });

  it('stores the response with the report TTL', async () => {
    nowSpy.mockReturnValue(new Date('2026-11-04T03:00:00.000Z'));

    await service.execute(request);

    expect(cache.set).toHaveBeenCalledWith(
      'report:balance-evolution:v4:ws-1:g7:7d:2026-11-04',
      expect.any(String),
      LEDGER_CACHE_TTL_SECONDS,
    );
  });

  it('skips the cache entirely when the generation is unreadable', async () => {
    cache.readCounter.mockResolvedValue(null);
    nowSpy.mockReturnValue(new Date('2026-11-04T03:00:00.000Z'));

    await service.execute(request);

    expect(cache.get).not.toHaveBeenCalled();
    expect(cache.set).not.toHaveBeenCalled();
  });
});
