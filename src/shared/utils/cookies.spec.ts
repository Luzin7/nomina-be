import { REFRESH_TOKEN_COOKIE, readCookie } from './cookies';

describe('readCookie', () => {
  it('should return the value when the cookie is present', () => {
    const header = `session=xyz; ${REFRESH_TOKEN_COOKIE}=abc123; theme=dark`;

    expect(readCookie(header, REFRESH_TOKEN_COOKIE)).toBe('abc123');
  });

  it('should return undefined when the header is missing', () => {
    expect(readCookie(undefined, REFRESH_TOKEN_COOKIE)).toBeUndefined();
  });

  it('should return undefined when the cookie is absent', () => {
    expect(readCookie('session=xyz; theme=dark', REFRESH_TOKEN_COOKIE)).toBe(
      undefined,
    );
  });
});
