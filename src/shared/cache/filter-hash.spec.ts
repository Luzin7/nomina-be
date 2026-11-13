import { hashFilters } from './filter-hash';

describe('hashFilters', () => {
  it('returns the same hash regardless of key order', () => {
    expect(hashFilters({ b: 2, a: 1 })).toBe(hashFilters({ a: 1, b: 2 }));
  });

  it('ignores undefined and empty string values', () => {
    expect(hashFilters({ a: 1, b: undefined, c: '' })).toBe(
      hashFilters({ a: 1 }),
    );
  });

  it('returns a different hash for different values', () => {
    expect(hashFilters({ a: 1 })).not.toBe(hashFilters({ a: 2 }));
  });

  it('orders keys by code unit, keeping uppercase before lowercase', () => {
    expect(hashFilters({ a: 1, B: 2 })).toBe(hashFilters({ B: 2, a: 1 }));
  });

  it('returns a 16 character hex string', () => {
    expect(hashFilters({ a: 1 })).toMatch(/^[0-9a-f]{16}$/);
  });
});
