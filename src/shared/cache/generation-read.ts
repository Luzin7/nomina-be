import { CacheProvider } from '@infra/cache/contracts/CacheProvider';
import { RedisUnavailableError } from '@infra/cache/redis/errors/RedisUnavailableError';
import { Logger } from '@nestjs/common';
import { errorClassOf } from './error-class';

const logger = new Logger('CacheGenerationRead');

interface GenerationReadInput {
  cache: CacheProvider;
  route: string;
  counterKey: string;
}

export async function readGenerationCounter({
  cache,
  route,
  counterKey,
}: GenerationReadInput): Promise<number | null> {
  try {
    const generation = await cache.readCounter(counterKey, Date.now());
    if (generation !== null) return generation;

    if (cache.isEnabled !== true) {
      logger.debug(`cache=miss route=${route} key=${counterKey}`);
      return null;
    }

    return reportFailure(
      route,
      counterKey,
      new RedisUnavailableError(`no generation stored for ${counterKey}`),
    );
  } catch (error) {
    return reportFailure(route, counterKey, error);
  }
}

function reportFailure(
  route: string,
  counterKey: string,
  error: unknown,
): null {
  logger.error(
    `cache=error route=${route} key=${counterKey} errorClass=${errorClassOf(error)}`,
  );
  return null;
}
