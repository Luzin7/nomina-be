import { CacheProvider } from '@infra/cache/contracts/CacheProvider';
import { bumpGeneration } from '@shared/cache/generation-counter';

export const CATEGORIES_CACHE_TTL_SECONDS = 30 * 60;
export const CATEGORY_LIST_CACHE_PREFIX = 'categories:list:';

export const categoryGenerationKey = (workspaceId: string): string =>
  `cache-gen:category:${workspaceId}`;

export const readCategoryGeneration = (
  cache: CacheProvider,
  workspaceId: string,
): Promise<number | null> =>
  cache.readCounter(categoryGenerationKey(workspaceId), Date.now());

export const invalidateCategoryReads = (
  cache: CacheProvider,
  workspaceId: string,
  operation: string,
): Promise<void> =>
  bumpGeneration({
    cache,
    counterKey: categoryGenerationKey(workspaceId),
    workspaceId,
    operation,
  });

interface CategoryListCacheKeyInput {
  workspaceId: string;
  type?: string;
  parentId?: string;
  page: number;
  pageSize: number;
  hidden: 'false' | 'all';
}

export function buildCategoryListCacheKey(
  {
    workspaceId,
    type,
    parentId,
    page,
    pageSize,
    hidden,
  }: CategoryListCacheKeyInput,
  generation: number,
): string {
  return `${CATEGORY_LIST_CACHE_PREFIX}${workspaceId}:g${generation}:t=${type ?? ''}:p=${parentId ?? 'none'}:h=${hidden}:${page}:${pageSize}`;
}
