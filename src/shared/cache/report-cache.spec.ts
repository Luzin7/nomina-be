import { CacheProvider } from '@infra/cache/contracts/CacheProvider';
import {
  REPORT_CACHE_TTL_SECONDS,
  bumpReportGeneration,
  readReportGeneration,
  reportGenerationKey,
} from './report-cache';

const NOW_MS = 1_700_000_000_000;

function makeInMemoryCache() {
  const counters = new Map<string, number>();
  const values = new Map<string, string>();
  const cache = {
    readCounter: jest.fn(async (key: string, initial: number) => {
      if (!counters.has(key)) counters.set(key, initial);
      return counters.get(key) ?? null;
    }),
    incrementCounter: jest.fn(async (key: string, initial: number) => {
      const next = (counters.get(key) ?? initial) + 1;
      counters.set(key, next);
      return next;
    }),
    get: jest.fn(async (key: string) => values.get(key) ?? null),
    set: jest.fn(async (key: string, value: string) => {
      values.set(key, value);
      return true;
    }),
    delByPattern: jest.fn().mockResolvedValue(0),
  } as unknown as jest.Mocked<CacheProvider>;

  return { cache, counters };
}

describe('report-cache', () => {
  beforeEach(() => jest.spyOn(Date, 'now').mockReturnValue(NOW_MS));
  afterEach(() => jest.restoreAllMocks());

  it('uses a six hour TTL', () => {
    expect(REPORT_CACHE_TTL_SECONDS).toBe(21_600);
  });

  it('keeps the generation key outside the report namespace', () => {
    expect(reportGenerationKey('ws-1')).toBe('cache-gen:report:ws-1');
  });

  it('initialises a missing generation with the current time', async () => {
    const { cache, counters } = makeInMemoryCache();

    await expect(readReportGeneration(cache, 'ws-1')).resolves.toBe(NOW_MS);
    expect(cache.readCounter).toHaveBeenCalledWith(
      'cache-gen:report:ws-1',
      NOW_MS,
    );
    expect(counters.get('cache-gen:report:ws-1')).toBe(NOW_MS);
  });

  it('returns null when the generation is unreadable', async () => {
    const { cache } = makeInMemoryCache();
    cache.readCounter.mockResolvedValue(null);

    await expect(readReportGeneration(cache, 'ws-1')).resolves.toBeNull();
  });

  it('bumps the generation without scanning the keyspace', async () => {
    const { cache, counters } = makeInMemoryCache();
    counters.set('cache-gen:report:ws-1', 5);

    await bumpReportGeneration(cache, 'ws-1');

    expect(counters.get('cache-gen:report:ws-1')).toBe(6);
    expect(cache.incrementCounter).toHaveBeenCalledWith(
      'cache-gen:report:ws-1',
      NOW_MS,
    );
    expect(cache.delByPattern).not.toHaveBeenCalled();
  });

  it('keeps a late set from being served after a concurrent write', async () => {
    const { cache } = makeInMemoryCache();
    const keyFor = (generation: number) => `report:x:v1:ws-1:g${generation}`;

    const generationAtRead = await readReportGeneration(cache, 'ws-1');
    await bumpReportGeneration(cache, 'ws-1');
    await cache.set(keyFor(generationAtRead as number), 'stale');
    const generationAfterWrite = await readReportGeneration(cache, 'ws-1');

    await expect(
      cache.get(keyFor(generationAfterWrite as number)),
    ).resolves.toBeNull();
  });
});
