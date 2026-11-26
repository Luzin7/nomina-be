export interface CacheGenerations {
  ledger?: number | null;
  category?: number | null;
  goal?: number | null;
  months?: Record<string, number | null>;
}

type KeyPart = string | number | null | undefined;

interface CacheKeyInput {
  route: string;
  version: string;
  workspaceId: string;
  generations: CacheGenerations;
  parts?: KeyPart[];
}

const GENERATION_PREFIXES: Array<[keyof CacheGenerations, string]> = [
  ['ledger', 'g'],
  ['category', 'c'],
  ['goal', 'o'],
];

export function buildCacheKey({
  route,
  version,
  workspaceId,
  generations,
  parts = [],
}: CacheKeyInput): string | null {
  const segments: string[] = [];

  for (const [domain, prefix] of GENERATION_PREFIXES) {
    const generation = generations[domain];
    if (generation === undefined) continue;
    if (generation === null) return null;
    segments.push(`${prefix}${generation}`);
  }

  const monthEntries = Object.entries(generations.months ?? {}).sort(
    ([left], [right]) => left.localeCompare(right),
  );
  for (const [month, generation] of monthEntries) {
    if (generation === null) return null;
    segments.push(`m${month}${generation}`);
  }

  const tail = parts.map((part) => String(part ?? ''));
  return [route, version, workspaceId, ...segments, ...tail].join(':');
}
