import { CacheProvider } from '@infra/cache/contracts/CacheProvider';
import { Logger } from '@nestjs/common';

const logger = new Logger('CacheGeneration');

interface BumpGenerationInput {
  cache: CacheProvider;
  counterKey: string;
  workspaceId: string;
  operation: string;
}

export async function bumpGeneration({
  cache,
  counterKey,
  workspaceId,
  operation,
}: BumpGenerationInput): Promise<void> {
  const failureMessage = `cache generation ${counterKey} bump failed for workspace ${workspaceId} during ${operation}`;

  try {
    const generation = await cache.incrementCounter(counterKey, Date.now());
    if (generation !== null) return;

    logger.error(failureMessage);
  } catch (error) {
    logger.error(failureMessage, error);
  }
}
