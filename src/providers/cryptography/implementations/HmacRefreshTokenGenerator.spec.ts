import { EmptyRefreshTokenKeyError } from '../errors/EmptyRefreshTokenKeyError';
import { HmacRefreshTokenGenerator } from './HmacRefreshTokenGenerator';

describe('HmacRefreshTokenGenerator', () => {
  const generator = new HmacRefreshTokenGenerator('key-a');

  it('should derive the same successor for the same token', () => {
    expect(generator.successorOf('token')).toBe(generator.successorOf('token'));
  });

  it('should derive different successors for different tokens', () => {
    expect(generator.successorOf('token-a')).not.toBe(
      generator.successorOf('token-b'),
    );
  });

  it('should derive the same successor for escaped and real newlines in the key', () => {
    const escaped = new HmacRefreshTokenGenerator(String.raw`line-a\nline-b`);
    const real = new HmacRefreshTokenGenerator('line-a\nline-b');

    expect(escaped.successorOf('token')).toBe(real.successorOf('token'));
  });

  it('should derive different successors for different keys', () => {
    const other = new HmacRefreshTokenGenerator('key-b');

    expect(other.successorOf('token')).not.toBe(generator.successorOf('token'));
  });

  it('should generate distinct url-safe tokens', () => {
    const first = generator.generate();
    const second = generator.generate();

    expect(first).not.toBe(second);
    expect(first).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it('should throw when the key material is empty', () => {
    expect(() => new HmacRefreshTokenGenerator('')).toThrow(
      EmptyRefreshTokenKeyError,
    );
  });

  it('should throw when the key material is blank', () => {
    expect(() => new HmacRefreshTokenGenerator('   ')).toThrow(
      EmptyRefreshTokenKeyError,
    );
  });
});
