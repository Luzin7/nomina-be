import { CacheProvider } from '@infra/cache/contracts/CacheProvider';
import { bumpGeneration } from './generation-counter';

export const LEDGER_CACHE_TTL_SECONDS = 30 * 60;
export const LEDGER_LIVE_CACHE_TTL_SECONDS = 15 * 60;

export const ledgerGenerationKey = (workspaceId: string): string =>
  `cache-gen:report:${workspaceId}`;

export const readLedgerGeneration = (
  cache: CacheProvider,
  workspaceId: string,
): Promise<number | null> =>
  cache.readCounter(ledgerGenerationKey(workspaceId), Date.now());

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
