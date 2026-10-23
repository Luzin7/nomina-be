import { RefreshTokenStatus } from '@constants/enums';
import { RefreshToken } from './RefreshToken';

describe('RefreshToken entity', () => {
  const FUTURE = new Date(Date.now() + 86_400_000);
  const PAST = new Date(Date.now() - 86_400_000);

  function makeProps(
    overrides: Partial<Parameters<typeof RefreshToken.create>[0]> = {},
  ) {
    return {
      sessionId: 'session-1',
      tokenHash: 'hashed-token',
      expiresAt: FUTURE,
      ...overrides,
    };
  }

  describe('create()', () => {
    it('should create a valid refresh token with default status', () => {
      const result = RefreshToken.create(makeProps());
      expect(result.isRight()).toBe(true);
      expect((result.value as RefreshToken).status).toBe(
        RefreshTokenStatus.ACTIVE,
      );
    });

    it('should reject empty token hash', () => {
      expect(RefreshToken.create(makeProps({ tokenHash: '' })).isLeft()).toBe(
        true,
      );
    });

    it('should reject empty session id', () => {
      expect(RefreshToken.create(makeProps({ sessionId: '' })).isLeft()).toBe(
        true,
      );
    });

    it('should reject past expiresAt for new tokens (no id)', () => {
      expect(RefreshToken.create(makeProps({ expiresAt: PAST })).isLeft()).toBe(
        true,
      );
    });

    it('should allow past expiresAt when restoring with an id', () => {
      expect(
        RefreshToken.create(
          makeProps({ expiresAt: PAST }),
          'existing-id',
        ).isRight(),
      ).toBe(true);
    });
  });

  describe('isExpired()', () => {
    it('should return false for a future expiration date', () => {
      const token = RefreshToken.create(makeProps()).value as RefreshToken;
      expect(token.isExpired(new Date())).toBe(false);
    });

    it('should return true when reference date is after expiration', () => {
      const token = RefreshToken.create(makeProps({ expiresAt: PAST }), 'id')
        .value as RefreshToken;
      expect(token.isExpired(new Date())).toBe(true);
    });
  });

  describe('validity and status', () => {
    it('should be valid when active and not expired', () => {
      const token = RefreshToken.create(makeProps()).value as RefreshToken;
      expect(token.isValid()).toBe(true);
    });

    it('should be invalid after being revoked', () => {
      const token = RefreshToken.create(makeProps()).value as RefreshToken;
      token.revoke();
      expect(token.status).toBe(RefreshTokenStatus.REVOKED);
      expect(token.isValid()).toBe(false);
    });

    it('should be invalid after being rotated', () => {
      const token = RefreshToken.create(makeProps()).value as RefreshToken;
      token.markAsRotated(new Date());
      expect(token.status).toBe(RefreshTokenStatus.ROTATED);
      expect(token.isValid()).toBe(false);
    });

    it('should not be reused while active', () => {
      const token = RefreshToken.create(makeProps()).value as RefreshToken;
      expect(token.isReused()).toBe(false);
    });

    it('should be reused after being rotated', () => {
      const token = RefreshToken.create(makeProps()).value as RefreshToken;
      token.markAsRotated(new Date());
      expect(token.isReused()).toBe(true);
    });

    it('should be reused after being revoked', () => {
      const token = RefreshToken.create(makeProps()).value as RefreshToken;
      token.revoke();
      expect(token.isReused()).toBe(true);
    });
  });

  describe('reuse grace', () => {
    const ROTATED_AT = new Date('2026-01-01T00:00:00Z');
    const secondsAfter = (seconds: number) =>
      new Date(ROTATED_AT.getTime() + seconds * 1_000);

    function makeRotatedToken(): RefreshToken {
      const token = RefreshToken.create(makeProps()).value as RefreshToken;
      token.markAsRotated(ROTATED_AT);
      return token;
    }

    it('should mark the token as rotated at the given time', () => {
      const token = makeRotatedToken();

      expect(token.status).toBe(RefreshTokenStatus.ROTATED);
      expect(token.rotatedAt).toEqual(ROTATED_AT);
    });

    it('should be within the reuse grace before the window closes', () => {
      expect(makeRotatedToken().isWithinReuseGrace(secondsAfter(59))).toBe(
        true,
      );
    });

    it('should not be within the reuse grace once the window closes', () => {
      expect(makeRotatedToken().isWithinReuseGrace(secondsAfter(60))).toBe(
        false,
      );
    });

    it('should not be within the reuse grace without rotatedAt', () => {
      const token = RefreshToken.restore(
        {
          sessionId: 'session-1',
          tokenHash: 'hash',
          status: RefreshTokenStatus.ROTATED,
          expiresAt: FUTURE,
          createdAt: ROTATED_AT,
          rotatedAt: null,
        },
        'id',
      );

      expect(token.isWithinReuseGrace(ROTATED_AT)).toBe(false);
    });
  });
});
