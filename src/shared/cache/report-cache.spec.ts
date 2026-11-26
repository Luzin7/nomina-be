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

describe('report-cache', () => {
  beforeEach(() => jest.spyOn(Date, 'now').mockReturnValue(NOW_MS));
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
