import { CacheProvider } from '@infra/cache/contracts/CacheProvider';
import { Logger } from '@nestjs/common';

const logger = new Logger('CategoryListCache');

export const categoryGenerationKey = (workspaceId: string): string =>
  `cache-gen:category:${workspaceId}`;

export const readCategoryGeneration = (
  cache: CacheProvider,
  workspaceId: string,
): Promise<number | null> =>
  cache.readCounter(categoryGenerationKey(workspaceId), Date.now());

interface BumpCategoryGenerationInput {
  cache: CacheProvider;
  workspaceId: string;
  operation: string;
}

export async function bumpCategoryGeneration({
  cache,
  workspaceId,
  operation,
}: BumpCategoryGenerationInput): Promise<void> {
  const failureMessage = `category list cache generation bump failed for workspace ${workspaceId} during ${operation}`;

  try {
    const generation = await cache.incrementCounter(
      categoryGenerationKey(workspaceId),
      Date.now(),
    );
    if (generation !== null) return;

    logger.error(failureMessage);
  } catch (error) {
    logger.error(failureMessage, error);
  }
}
