import { right } from '@shared/core/errors/Either';
import { readThrough } from './read-through';
import { InMemoryCacheProvider } from './test-helpers/in-memory-cache';

describe('readThrough', () => {
  let cache: InMemoryCacheProvider;

  beforeEach(() => {
    cache = new InMemoryCacheProvider();
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
