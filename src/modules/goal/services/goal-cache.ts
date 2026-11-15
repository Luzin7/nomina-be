import { CacheProvider } from '@infra/cache/contracts/CacheProvider';
import { bumpGeneration } from '@shared/cache/generation-counter';

export const GOAL_CACHE_TTL_SECONDS = 30 * 60;

export const goalGenerationKey = (workspaceId: string): string =>
  `cache-gen:goal:${workspaceId}`;

export const readGoalGeneration = (
  cache: CacheProvider,
  workspaceId: string,
): Promise<number | null> =>
  cache.readCounter(goalGenerationKey(workspaceId), Date.now());

export const invalidateGoalReads = (
  cache: CacheProvider,
  workspaceId: string,
  operation: string,
): Promise<void> =>
  bumpGeneration({
    cache,
    counterKey: goalGenerationKey(workspaceId),
    workspaceId,
    operation,
  });
