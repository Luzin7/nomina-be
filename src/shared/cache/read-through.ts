import { CacheProvider } from '@infra/cache/contracts/CacheProvider';
import { Logger } from '@nestjs/common';
import { performance } from 'node:perf_hooks';
import { Either, right } from '@shared/core/errors/Either';
import { CacheCodec, createStructuredCodec } from './cache-codec';

const logger = new Logger('ReadThrough');

interface ReadThroughInput<L, R> {
  cache: CacheProvider;
  key: string | null;
  ttlSeconds: number;
  load: () => Promise<Either<L, R>>;
  codec?: CacheCodec<R>;
  ttlFor?: (value: R) => number;
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

type MissOutcome = 'ok' | 'left' | 'error';

async function loadWithTelemetry<L, R>(
  key: string,
  load: () => Promise<Either<L, R>>,
): Promise<Either<L, R>> {
  const startedAt = performance.now();
  const eluStart = performance.eventLoopUtilization();
  let outcome: MissOutcome = 'error';
  try {
    const result = await load();
    outcome = result.isLeft() ? 'left' : 'ok';
    return result;
  } finally {
    const elapsedMs = Math.round(performance.now() - startedAt);
    const { utilization } = performance.eventLoopUtilization(eluStart);
    logger.log(
      `read-through miss key=${key} outcome=${outcome} elapsedMs=${elapsedMs} elu=${utilization.toFixed(2)}`,
    );
  }
}

export async function readThrough<L, R>({
  cache,
  key,
  ttlSeconds,
  load,
  codec = createStructuredCodec<R>(),
  ttlFor = () => ttlSeconds,
}: ReadThroughInput<L, R>): Promise<Either<L, R>> {
  if (key === null) return load();

  const cached = await readCached(cache, key, codec);
  if (cached !== null) return right(cached);

  const result = await loadWithTelemetry(key, load);
  if (result.isLeft()) return result;

  await storeCached(cache, key, result.value, ttlFor(result.value), codec);
  return result;
}
