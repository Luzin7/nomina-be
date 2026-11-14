import { CacheProvider } from '@infra/cache/contracts/CacheProvider';
import { Logger } from '@nestjs/common';
import { Either, right } from '@shared/core/errors/Either';
import { CacheCodec, createStructuredCodec } from './cache-codec';

const logger = new Logger('ReadThrough');

interface ReadThroughInput<L, R> {
  cache: CacheProvider;
  key: string | null;
  ttlSeconds: number;
  load: () => Promise<Either<L, R>>;
  codec?: CacheCodec<R>;
}

async function readCached<R>(
  cache: CacheProvider,
  key: string,
  codec: CacheCodec<R>,
): Promise<R | null> {
  const raw = await cache.get(key);
  if (raw === null || raw === undefined) return null;

  try {
    return codec.decode(raw);
  } catch (error) {
    logger.error(`cache entry ${key} discarded`, error);
    return null;
  }
}

async function storeCached<R>(
  cache: CacheProvider,
  key: string,
  value: R,
  ttlSeconds: number,
  codec: CacheCodec<R>,
): Promise<void> {
  try {
    await cache.set(key, codec.encode(value), ttlSeconds);
  } catch (error) {
    logger.error(`cache entry ${key} not stored`, error);
  }
}

export async function readThrough<L, R>({
  cache,
  key,
  ttlSeconds,
  load,
  codec = createStructuredCodec<R>(),
}: ReadThroughInput<L, R>): Promise<Either<L, R>> {
  if (key === null) return load();

  const cached = await readCached(cache, key, codec);
  if (cached !== null) return right(cached);

  const result = await load();
  if (result.isLeft()) return result;

  await storeCached(cache, key, result.value, ttlSeconds, codec);
  return result;
}
