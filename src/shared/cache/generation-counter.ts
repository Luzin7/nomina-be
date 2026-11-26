import { CacheProvider } from '@infra/cache/contracts/CacheProvider';
import { Logger } from '@nestjs/common';
import { captureException } from '@sentry/nestjs';
import { CacheGenerationBumpError } from './errors/CacheGenerationBumpError';

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
  const failure = new CacheGenerationBumpError(
    workspaceId,
    counterKey,
    operation,
  );

  try {
    const generation = await cache.incrementCounter(counterKey, Date.now());
    if (generation !== null) return;

    logger.error(failure.message);
  } catch (error) {
    failure.cause = error;
    logger.error(failure.message, error);
  }

  captureException(failure, { extra: { workspaceId, counterKey, operation } });
}
