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
      token.markAsRotated();
      expect(token.status).toBe(RefreshTokenStatus.ROTATED);
      expect(token.isValid()).toBe(false);
    });

    it('should not be reused while active', () => {
      const token = RefreshToken.create(makeProps()).value as RefreshToken;
      expect(token.isReused()).toBe(false);
    });

    it('should be reused after being rotated', () => {
      const token = RefreshToken.create(makeProps()).value as RefreshToken;
      token.markAsRotated();
      expect(token.isReused()).toBe(true);
    });

    it('should be reused after being revoked', () => {
      const token = RefreshToken.create(makeProps()).value as RefreshToken;
      token.revoke();
      expect(token.isReused()).toBe(true);
    });
  });
});
