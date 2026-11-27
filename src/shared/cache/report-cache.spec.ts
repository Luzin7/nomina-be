import { captureException } from '@sentry/nestjs';
import { CacheGenerationBumpError } from './errors/CacheGenerationBumpError';
import { resetReportThrottle } from './report-throttle';
import { InMemoryCacheProvider } from './test-helpers/in-memory-cache';
import {
  LEDGER_CACHE_TTL_SECONDS,
  LEDGER_LIVE_CACHE_TTL_SECONDS,
  invalidateLedgerReads,
  invalidateMonthReads,
  invalidateStructureReads,
  ledgerGenerationKey,
  monthGenerationKey,
  monthKeyOf,
  readLedgerGeneration,
  readMonthGeneration,
  readStructureGeneration,
  structureGenerationKey,
} from './report-cache';

const NOW_MS = 1_700_000_000_000;

jest.mock('@sentry/nestjs', () => ({ captureException: jest.fn() }));

const mockCaptureException = captureException as jest.MockedFunction<
  typeof captureException
>;

describe('report-cache', () => {
  beforeEach(() => {
    jest.spyOn(Date, 'now').mockReturnValue(NOW_MS);
    mockCaptureException.mockClear();
    resetReportThrottle();
  });
  afterEach(() => jest.restoreAllMocks());

  it('uses a thirty minute TTL for ledger reads', () => {
    expect(LEDGER_CACHE_TTL_SECONDS).toBe(1_800);
  });

  it('uses a fifteen minute TTL for live ledger reads', () => {
    expect(LEDGER_LIVE_CACHE_TTL_SECONDS).toBe(900);
  });

  it('keeps the generation key outside the report namespace', () => {
    expect(ledgerGenerationKey('ws-1')).toBe('cache-gen:report:ws-1');
  });

  it('initialises a missing generation with the current time', async () => {
    const cache = new InMemoryCacheProvider();

    await expect(readLedgerGeneration(cache, 'ws-1')).resolves.toBe(NOW_MS);
    expect(cache.counters.get('cache-gen:report:ws-1')).toBe(NOW_MS);
  });

  it('returns null when the generation is unreadable', async () => {
    const cache = new InMemoryCacheProvider();
    jest
      .spyOn(cache, 'readCounter')
      .mockResolvedValue(null as unknown as number);

    await expect(readLedgerGeneration(cache, 'ws-1')).resolves.toBeNull();
  });

  it('bumps the generation without scanning the keyspace', async () => {
    const cache = new InMemoryCacheProvider();
    const scan = jest.spyOn(cache, 'delByPattern');
    cache.counters.set('cache-gen:report:ws-1', 5);

    await invalidateLedgerReads(cache, 'ws-1', 'test-write');

    expect(cache.counters.get('cache-gen:report:ws-1')).toBe(6);
    expect(scan).not.toHaveBeenCalled();
  });

  it('composes the structure generation key', () => {
    expect(structureGenerationKey('ws-1')).toBe(
      'cache-gen:report:structure:ws-1',
    );
  });

  it('initialises a missing structure generation with the current time', async () => {
    const cache = new InMemoryCacheProvider();

    await expect(readStructureGeneration(cache, 'ws-1')).resolves.toBe(NOW_MS);
    expect(cache.counters.get('cache-gen:report:structure:ws-1')).toBe(NOW_MS);
  });

  it('bumps the structure generation without scanning the keyspace', async () => {
    const cache = new InMemoryCacheProvider();
    const scan = jest.spyOn(cache, 'delByPattern');
    cache.counters.set('cache-gen:report:structure:ws-1', 5);

    await invalidateStructureReads(cache, 'ws-1', 'test-write');

    expect(cache.counters.get('cache-gen:report:structure:ws-1')).toBe(6);
    expect(scan).not.toHaveBeenCalled();
  });

  it('composes the month generation key', () => {
    expect(monthGenerationKey('ws-1', '2026-11')).toBe(
      'cache-gen:report:month:ws-1:2026-11',
    );
  });

  it('formats a padded month key', () => {
    expect(monthKeyOf(2026, 3)).toBe('2026-03');
    expect(monthKeyOf(2026, 11)).toBe('2026-11');
  });

  it('initialises a missing month generation with the current time', async () => {
    const cache = new InMemoryCacheProvider();

    await expect(readMonthGeneration(cache, 'ws-1', '2026-11')).resolves.toBe(
      NOW_MS,
    );
    expect(cache.counters.get('cache-gen:report:month:ws-1:2026-11')).toBe(
      NOW_MS,
    );
  });

  it('bumps the global generation and every touched month', async () => {
    const cache = new InMemoryCacheProvider();
    cache.counters.set('cache-gen:report:ws-1', 5);
    cache.counters.set('cache-gen:report:month:ws-1:2026-11', 8);

    await invalidateMonthReads(
      cache,
      'ws-1',
      ['2026-11', '2026-12', '2026-11'],
      'test-write',
    );

    expect(cache.counters.get('cache-gen:report:ws-1')).toBe(6);
    expect(cache.counters.get('cache-gen:report:month:ws-1:2026-11')).toBe(9);
    expect(cache.counters.get('cache-gen:report:month:ws-1:2026-12')).toBe(
      NOW_MS + 1,
    );
    expect(cache.counters.get('cache-gen:report:month:ws-1:2026-10')).toBe(
      undefined,
    );
  });

  it('captures a bump that returns no generation', async () => {
    const cache = new InMemoryCacheProvider();
    jest
      .spyOn(cache, 'incrementCounter')
      .mockResolvedValue(null as unknown as number);

    await expect(
      invalidateStructureReads(cache, 'ws-1', 'delete-account'),
    ).resolves.toBeUndefined();

    expect(mockCaptureException).toHaveBeenCalledTimes(1);
    const [error, context] = mockCaptureException.mock.calls[0];
    expect(error).toBeInstanceOf(CacheGenerationBumpError);
    expect(error).toMatchObject({
      workspaceId: 'ws-1',
      counterKey: 'cache-gen:report:structure:ws-1',
      operation: 'delete-account',
    });
    expect(context).toEqual({
      extra: {
        workspaceId: 'ws-1',
        counterKey: 'cache-gen:report:structure:ws-1',
        operation: 'delete-account',
      },
    });
  });

  it('captures the cause of a bump that throws', async () => {
    const cache = new InMemoryCacheProvider();
    const cause = new Error('redis down');
    jest.spyOn(cache, 'incrementCounter').mockRejectedValue(cause);

    await invalidateLedgerReads(cache, 'ws-1', 'create-transaction');

    expect(mockCaptureException).toHaveBeenCalledTimes(1);
    const [error] = mockCaptureException.mock.calls[0];
    expect(error).toBeInstanceOf(CacheGenerationBumpError);
    expect((error as CacheGenerationBumpError).cause).toBe(cause);
  });

  it('captures every failed bump in a month invalidation', async () => {
    const cache = new InMemoryCacheProvider();
    jest
      .spyOn(cache, 'incrementCounter')
      .mockResolvedValue(null as unknown as number);

    await invalidateMonthReads(
      cache,
      'ws-1',
      ['2026-11'],
      'create-transaction',
    );

    expect(mockCaptureException).toHaveBeenCalledTimes(2);
    const keys = mockCaptureException.mock.calls.map(
      ([, context]) =>
        (context as { extra: { counterKey: string } }).extra.counterKey,
    );
    expect(keys).toEqual([
      'cache-gen:report:ws-1',
      'cache-gen:report:month:ws-1:2026-11',
    ]);
  });

  it('reports one bump failure per window for the same operation and family', async () => {
    const cache = new InMemoryCacheProvider();
    jest
      .spyOn(cache, 'incrementCounter')
      .mockResolvedValue(null as unknown as number);

    await invalidateMonthReads(cache, 'ws-1', ['2026-11'], 'recurring-run');
    await invalidateMonthReads(cache, 'ws-1', ['2026-12'], 'recurring-run');

    expect(mockCaptureException).toHaveBeenCalledTimes(2);
    const keys = mockCaptureException.mock.calls.map(
      ([, context]) =>
        (context as { extra: { counterKey: string } }).extra.counterKey,
    );
    expect(keys).toEqual([
      'cache-gen:report:ws-1',
      'cache-gen:report:month:ws-1:2026-11',
    ]);
  });

  it('reports a suppressed bump failure again once the window has passed', async () => {
    const cache = new InMemoryCacheProvider();
    jest
      .spyOn(cache, 'incrementCounter')
      .mockResolvedValue(null as unknown as number);

    await invalidateStructureReads(cache, 'ws-1', 'recurring-run');
    await invalidateStructureReads(cache, 'ws-1', 'recurring-run');
    expect(mockCaptureException).toHaveBeenCalledTimes(1);

    jest.spyOn(Date, 'now').mockReturnValue(NOW_MS + 60_001);
    await invalidateStructureReads(cache, 'ws-1', 'recurring-run');

    expect(mockCaptureException).toHaveBeenCalledTimes(2);
  });

  it('keeps one window per counter family', async () => {
    const cache = new InMemoryCacheProvider();
    jest
      .spyOn(cache, 'incrementCounter')
      .mockResolvedValue(null as unknown as number);

    await invalidateLedgerReads(cache, 'ws-1', 'recurring-run');
    await invalidateLedgerReads(cache, 'ws-1', 'other-job');
    await invalidateStructureReads(cache, 'ws-1', 'recurring-run');

    expect(mockCaptureException).toHaveBeenCalledTimes(3);
  });

  it('keeps a late set from being served after a concurrent write', async () => {
    const cache = new InMemoryCacheProvider();
    const keyFor = (generation: number) => `report:x:v1:ws-1:g${generation}`;

    const generationAtRead = await readLedgerGeneration(cache, 'ws-1');
    await invalidateLedgerReads(cache, 'ws-1', 'test-write');
    await cache.set(keyFor(generationAtRead as number), 'stale', 60);
    const generationAfterWrite = await readLedgerGeneration(cache, 'ws-1');

    await expect(
      cache.get(keyFor(generationAfterWrite as number)),
    ).resolves.toBeNull();
  });
});
