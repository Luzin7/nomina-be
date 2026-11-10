export const CATEGORY_LIST_CACHE_PREFIX = 'categories:list:';

interface CategoryListCacheKeyInput {
  workspaceId: string;
  type?: string;
  parentId?: string;
  page: number;
  pageSize: number;
  hidden: 'false' | 'all';
}

export function buildCategoryListCacheKey({
  workspaceId,
  type,
  parentId,
  page,
  pageSize,
  hidden,
}: CategoryListCacheKeyInput): string {
  return `${CATEGORY_LIST_CACHE_PREFIX}${workspaceId}:t=${type ?? ''}:p=${parentId ?? 'none'}:h=${hidden}:${page}:${pageSize}`;
}

export function buildCategoryListInvalidationPattern(
  workspaceId: string,
): string {
  return `${CATEGORY_LIST_CACHE_PREFIX}${workspaceId}:*`;
}
