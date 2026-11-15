import { createHash } from 'node:crypto';

type FilterValue = string | number | boolean | null | undefined;

function compareKeysByCodeUnit(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

export function hashFilters(filters: Record<string, FilterValue>): string {
  const normalized = Object.keys(filters)
    .sort(compareKeysByCodeUnit)
    .filter((key) => filters[key] !== undefined && filters[key] !== '')
    .map((key) => [key, filters[key]]);

  return createHash('sha256')
    .update(JSON.stringify(normalized))
    .digest('hex')
    .slice(0, 16);
}
