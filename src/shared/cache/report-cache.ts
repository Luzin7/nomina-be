import { CacheProvider } from '@infra/cache/contracts/CacheProvider';

export const REPORT_CACHE_TTL_SECONDS = 6 * 60 * 60;

export const reportGenerationKey = (workspaceId: string): string =>
  `cache-gen:report:${workspaceId}`;

export const monthSummaryReportCachePattern = (workspaceId: string): string =>
  `report:month-summary:*:${workspaceId}:*`;

export const readReportGeneration = (
  cache: CacheProvider,
  workspaceId: string,
): Promise<number | null> =>
  cache.readCounter(reportGenerationKey(workspaceId), Date.now());

export async function bumpReportGeneration(
  cache: CacheProvider,
  workspaceId: string,
): Promise<void> {
  await cache.incrementCounter(reportGenerationKey(workspaceId), Date.now());
  await cache.delByPattern(monthSummaryReportCachePattern(workspaceId));
}
