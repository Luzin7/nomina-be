import { Sha256TokenHasher } from './Sha256TokenHasher';

describe('Sha256TokenHasher', () => {
  const hasher = new Sha256TokenHasher();

  it('should hash the token deterministically', () => {
    expect(hasher.hash('token')).toBe(hasher.hash('token'));
  });

  it('should produce a different hash for a different token', () => {
    expect(hasher.hash('token-a')).not.toBe(hasher.hash('token-b'));
  });

  it('should produce a 64-character hex digest', () => {
    expect(hasher.hash('token')).toMatch(/^[a-f0-9]{64}$/);
  });
});
