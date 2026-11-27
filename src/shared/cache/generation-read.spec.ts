import { CacheProvider } from '@infra/cache/contracts/CacheProvider';
import { RedisReadFailedError } from '@infra/cache/redis/errors/RedisReadFailedError';
import { Logger } from '@nestjs/common';
import { readGenerationCounter } from './generation-read';

const COUNTER_KEY = 'cache-gen:report:ws-1';

describe('readGenerationCounter', () => {
  let cache: jest.Mocked<CacheProvider>;
  let errorSpy: jest.SpyInstance;
  let debugSpy: jest.SpyInstance;

  beforeEach(() => {
    cache = {
      isEnabled: true,
      readCounter: jest.fn().mockResolvedValue(7),
    } as unknown as jest.Mocked<CacheProvider>;
    errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation();
    debugSpy = jest.spyOn(Logger.prototype, 'debug').mockImplementation();
  });

  afterEach(() => jest.restoreAllMocks());

  it('returns the stored generation without logging', async () => {
    const generation = await readGenerationCounter({
      cache,
      route: 'report',
      counterKey: COUNTER_KEY,
    });

    expect(generation).toBe(7);
    expect(cache.readCounter).toHaveBeenCalledWith(
      COUNTER_KEY,
      expect.any(Number),
    );
    expect(errorSpy).not.toHaveBeenCalled();
    expect(debugSpy).not.toHaveBeenCalled();
  });

  it('reports cache=miss when the counter store is not enabled', async () => {
    const disabledCache = {
      isEnabled: false,
      readCounter: jest.fn().mockResolvedValue(null),
    } as unknown as jest.Mocked<CacheProvider>;

    const generation = await readGenerationCounter({
      cache: disabledCache,
      route: 'report',
      counterKey: COUNTER_KEY,
    });

    expect(generation).toBeNull();
    expect(errorSpy).not.toHaveBeenCalled();
    expect(debugSpy).toHaveBeenCalledWith(
      `cache=miss route=report key=${COUNTER_KEY}`,
    );
  });

  it('reports cache=error with the class of the error thrown by the counter store', async () => {
    cache.readCounter.mockRejectedValue(
      new RedisReadFailedError(COUNTER_KEY, new Error('connection reset')),
    );

    const generation = await readGenerationCounter({
      cache,
      route: 'report',
      counterKey: COUNTER_KEY,
    });

    expect(generation).toBeNull();
    expect(debugSpy).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalledWith(
      `cache=error route=report key=${COUNTER_KEY} errorClass=RedisReadFailedError`,
    );
  });

  it('reports cache=error when an enabled counter store returns no generation', async () => {
    cache.readCounter.mockResolvedValue(null);

    const generation = await readGenerationCounter({
      cache,
      route: 'report',
      counterKey: COUNTER_KEY,
    });

    expect(generation).toBeNull();
    expect(debugSpy).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalledWith(
      `cache=error route=report key=${COUNTER_KEY} errorClass=RedisUnavailableError`,
    );
  });
});
