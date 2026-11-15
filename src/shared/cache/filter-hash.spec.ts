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

  it('keeps the hash of mixed-case keys stable', () => {
    expect(hashFilters({ a: 1, B: 2 })).toBe('fa712e621486bed1');
  });

  it('keeps the hash of non-ASCII keys stable', () => {
    expect(hashFilters({ é: 1, z: 2 })).toBe('6383dadcacf821f1');
  });

  it('keeps the hash of a single key stable', () => {
    expect(hashFilters({ a: 1 })).toBe('38d8e023d06e961f');
  });

  it('returns a 16 character hex string', () => {
    expect(hashFilters({ a: 1 })).toMatch(/^[0-9a-f]{16}$/);
  });
});
