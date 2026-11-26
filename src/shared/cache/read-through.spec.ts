import { Logger } from '@nestjs/common';
import { left, right } from '@shared/core/errors/Either';
import { readThrough } from './read-through';
import { InMemoryCacheProvider } from './test-helpers/in-memory-cache';

describe('readThrough', () => {
  let cache: InMemoryCacheProvider;

  let logSpy: jest.SpyInstance;

  beforeEach(() => {
    cache = new InMemoryCacheProvider();
    logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation();
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  const missPattern = (key: string, outcome: string, cache = 'miss') =>
    new RegExp(
      `^read-through miss key=${key} cache=${cache} outcome=${outcome} elapsedMs=\\d+ elu=\\d\\.\\d{2}$`,
    );

  it('logs one line on a miss whose load succeeds', async () => {
    await readThrough({
      cache,
      key: 'k',
      ttlSeconds: 900,
      load: async () => right({ ok: true }),
    });

    expect(logSpy).toHaveBeenCalledTimes(1);
    expect(logSpy.mock.calls[0][0]).toMatch(missPattern('k', 'ok'));
  });

  it('logs one line on a miss whose load returns left', async () => {
    await readThrough({
      cache,
      key: 'k',
      ttlSeconds: 900,
      load: async () => left(new Error('failed')),
    });

    expect(logSpy).toHaveBeenCalledTimes(1);
    expect(logSpy.mock.calls[0][0]).toMatch(missPattern('k', 'left'));
  });

  it('logs one line on a miss whose load throws and rethrows', async () => {
    await expect(
      readThrough({
        cache,
        key: 'k',
        ttlSeconds: 900,
        load: async () => {
          throw new Error('boom');
        },
      }),
    ).rejects.toThrow('boom');

    expect(logSpy).toHaveBeenCalledTimes(1);
    expect(logSpy.mock.calls[0][0]).toMatch(missPattern('k', 'error'));
  });

  it('logs nothing on a hit', async () => {
    await cache.set('k', JSON.stringify({ ok: true }), 900);
    const load = jest.fn(async () => right({ ok: true }));

    await readThrough({ cache, key: 'k', ttlSeconds: 900, load });

    expect(load).not.toHaveBeenCalled();
    expect(logSpy).not.toHaveBeenCalled();
  });

  it('stores with the default ttl when ttlFor is absent', async () => {
    await readThrough({
      cache,
      key: 'k',
      ttlSeconds: 900,
      load: async () => right({ degraded: true }),
    });

    expect(cache.ttls.get('k')).toBe(900);
  });

  it('logs cache=error when the cache read fails', async () => {
    jest.spyOn(cache, 'get').mockRejectedValue(new Error('connection reset'));

    await readThrough({
      cache,
      key: 'k',
      ttlSeconds: 900,
      load: async () => right({ ok: true }),
    });

    expect(logSpy).toHaveBeenCalledTimes(1);
    expect(logSpy.mock.calls[0][0]).toMatch(missPattern('k', 'ok', 'error'));
  });

  it('stores with the ttl returned by ttlFor for the loaded value', async () => {
    await readThrough({
      cache,
      key: 'k',
      ttlSeconds: 900,
      load: async () => right({ degraded: true }),
      ttlFor: ({ degraded }) => (degraded ? 60 : 900),
    });

    expect(cache.ttls.get('k')).toBe(60);
  });
});
