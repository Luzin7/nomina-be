import { buildCacheKey } from './cache-key';

const base = {
  route: 'report:month-pace',
  version: 'v1',
  workspaceId: 'ws-1',
};

describe('buildCacheKey', () => {
  it('adds the month generations sorted by month', () => {
    const key = buildCacheKey({
      ...base,
      generations: {
        category: 4,
        months: { '2026-11': 3, '2026-10': 2 },
      },
    });

    expect(key).toBe('report:month-pace:v1:ws-1:c4:m2026-102:m2026-113');
  });

  it('bypasses the cache when a month generation is null', () => {
    const key = buildCacheKey({
      ...base,
      generations: { months: { '2026-11': 3, '2026-12': null } },
    });

    expect(key).toBeNull();
  });

  it('keeps the key unchanged when no month is requested', () => {
    const key = buildCacheKey({
      ...base,
      generations: { ledger: 7 },
    });

    expect(key).toBe('report:month-pace:v1:ws-1:g7');
  });
});
