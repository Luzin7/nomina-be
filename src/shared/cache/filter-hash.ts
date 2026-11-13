import { createHash } from 'node:crypto';

type FilterValue = string | number | boolean | null | undefined;

export function hashFilters(filters: Record<string, FilterValue>): string {
  const normalized = Object.keys(filters)
    .sort()
    .filter((key) => filters[key] !== undefined && filters[key] !== '')
    .map((key) => [key, filters[key]]);

  return createHash('sha256')
    .update(JSON.stringify(normalized))
    .digest('hex')
    .slice(0, 16);
}
