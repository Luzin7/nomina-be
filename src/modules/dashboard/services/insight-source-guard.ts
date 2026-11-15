import { InsightSourceTimeoutError } from '../errors';
import type {
  AvailableToSpendInsight,
  InsightCode,
} from '../valueObjects/AvailableToSpend';

export const INSIGHT_SOURCE_TIMEOUT_MS = 250;

export type InsightSource = {
  code: InsightCode;
  resolve: () => Promise<AvailableToSpendInsight | null>;
};

export type InsightSourceFailure = { code: InsightCode; error: unknown };

export type InsightResolution = {
  insight: AvailableToSpendInsight | null;
  failures: InsightSourceFailure[];
};

const guard = (
  source: InsightSource,
): Promise<AvailableToSpendInsight | null> => {
  const pending = Promise.resolve().then(source.resolve);
  pending.catch(() => undefined);

  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(
      () => reject(new InsightSourceTimeoutError(source.code)),
      INSIGHT_SOURCE_TIMEOUT_MS,
    );
  });

  return Promise.race([pending, timeout]).finally(() => clearTimeout(timer));
};

export async function resolveInsight(
  sources: InsightSource[],
): Promise<InsightResolution> {
  const settled = await Promise.allSettled(sources.map(guard));

  const failures = settled.flatMap((result, index) =>
    result.status === 'rejected'
      ? [{ code: sources[index].code, error: result.reason as unknown }]
      : [],
  );
  if (failures.length > 0) return { insight: null, failures };

  const winner = settled.find(
    (result) => result.status === 'fulfilled' && result.value !== null,
  );

  return {
    insight: winner?.status === 'fulfilled' ? winner.value : null,
    failures,
  };
}
