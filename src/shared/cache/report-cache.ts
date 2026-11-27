import { CacheProvider } from '@infra/cache/contracts/CacheProvider';
import { bumpGeneration } from './generation-counter';
import { readGenerationCounter } from './generation-read';

export const LEDGER_CACHE_TTL_SECONDS = 30 * 60;
export const LEDGER_LIVE_CACHE_TTL_SECONDS = 15 * 60;

export const ledgerGenerationKey = (workspaceId: string): string =>
  `cache-gen:report:${workspaceId}`;

export const monthGenerationKey = (
  workspaceId: string,
  month: string,
): string => `cache-gen:report:month:${workspaceId}:${month}`;

export const structureGenerationKey = (workspaceId: string): string =>
  `cache-gen:report:structure:${workspaceId}`;

export const monthKeyOf = (year: number, month: number): string =>
  `${year}-${String(month).padStart(2, '0')}`;

export const readLedgerGeneration = (
  cache: CacheProvider,
  workspaceId: string,
): Promise<number | null> =>
  readGenerationCounter({
    cache,
    route: 'report',
    counterKey: ledgerGenerationKey(workspaceId),
  });

export const readMonthGeneration = (
  cache: CacheProvider,
  workspaceId: string,
  month: string,
): Promise<number | null> =>
  readGenerationCounter({
    cache,
    route: 'report',
    counterKey: monthGenerationKey(workspaceId, month),
  });

export const readStructureGeneration = (
  cache: CacheProvider,
  workspaceId: string,
): Promise<number | null> =>
  readGenerationCounter({
    cache,
    route: 'report',
    counterKey: structureGenerationKey(workspaceId),
  });

export const invalidateLedgerReads = (
  cache: CacheProvider,
  workspaceId: string,
  operation: string,
): Promise<void> =>
  bumpGeneration({
    cache,
    counterKey: ledgerGenerationKey(workspaceId),
    workspaceId,
    operation,
  });

export const invalidateStructureReads = (
  cache: CacheProvider,
  workspaceId: string,
  operation: string,
): Promise<void> =>
  bumpGeneration({
    cache,
    counterKey: structureGenerationKey(workspaceId),
    workspaceId,
    operation,
  });

export const invalidateMonthReads = (
  cache: CacheProvider,
  workspaceId: string,
  months: Iterable<string>,
  operation: string,
): Promise<void> => {
  const counterKeys = [
    ledgerGenerationKey(workspaceId),
    ...[...new Set(months)].map((month) =>
      monthGenerationKey(workspaceId, month),
    ),
  ];

  return Promise.all(
    counterKeys.map((counterKey) =>
      bumpGeneration({ cache, counterKey, workspaceId, operation }),
    ),
  ).then(() => undefined);
};
