import { normalizePemNewlines } from './normalizePemNewlines';

describe('normalizePemNewlines', () => {
  it('should turn escaped newlines into real newlines', () => {
    expect(normalizePemNewlines(String.raw`a\nb`)).toBe('a\nb');
  });

  it('should keep real newlines untouched', () => {
    expect(normalizePemNewlines('a\nb')).toBe('a\nb');
  });
});
