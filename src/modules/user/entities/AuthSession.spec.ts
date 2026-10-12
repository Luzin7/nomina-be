import { AuthSession } from './AuthSession';

describe('AuthSession entity', () => {
  const FUTURE = new Date(Date.now() + 86_400_000);
  const PAST = new Date(Date.now() - 86_400_000);

  function makeProps(
    overrides: Partial<Parameters<typeof AuthSession.create>[0]> = {},
  ) {
    return {
      userId: 'user-1',
      expiresAt: FUTURE,
      ...overrides,
    };
  }

  describe('create()', () => {
    it('should create a valid session with defaults', () => {
      const result = AuthSession.create(makeProps());
      expect(result.isRight()).toBe(true);

      const session = result.value as AuthSession;
      expect(session.userAgent).toBeNull();
      expect(session.revokedAt).toBeNull();
      expect(session.createdAt).toBeInstanceOf(Date);
      expect(session.lastUsedAt).toBeInstanceOf(Date);
    });

    it('should reject empty user id', () => {
      expect(AuthSession.create(makeProps({ userId: '' })).isLeft()).toBe(true);
    });

    it('should reject past expiresAt for new sessions (no id)', () => {
      expect(AuthSession.create(makeProps({ expiresAt: PAST })).isLeft()).toBe(
        true,
      );
    });

    it('should allow past expiresAt when restoring with an id', () => {
      expect(
        AuthSession.create(
          makeProps({ expiresAt: PAST }),
          'existing-id',
        ).isRight(),
      ).toBe(true);
    });
  });

  describe('isExpired()', () => {
    it('should return false for a future expiration date', () => {
      const session = AuthSession.create(makeProps()).value as AuthSession;
      expect(session.isExpired(new Date())).toBe(false);
    });

    it('should return true when reference date is after expiration', () => {
      const session = AuthSession.create(makeProps({ expiresAt: PAST }), 'id')
        .value as AuthSession;
      expect(session.isExpired(new Date())).toBe(true);
    });
  });

  describe('isValid()', () => {
    it('should be valid when not revoked and not expired', () => {
      const session = AuthSession.create(makeProps()).value as AuthSession;
      expect(session.isValid()).toBe(true);
    });

    it('should be invalid after being revoked', () => {
      const session = AuthSession.create(makeProps()).value as AuthSession;
      session.revoke();
      expect(session.isRevoked()).toBe(true);
      expect(session.isValid()).toBe(false);
    });

    it('should be invalid when expired', () => {
      const session = AuthSession.create(makeProps({ expiresAt: PAST }), 'id')
        .value as AuthSession;
      expect(session.isValid()).toBe(false);
    });
  });

  describe('renew()', () => {
    it('should extend expiry and update lastUsedAt', () => {
      const session = AuthSession.create(makeProps()).value as AuthSession;
      const reference = new Date(Date.now() + 1_000);
      const extended = new Date(Date.now() + 999_999);

      session.renew(extended, reference);

      expect(session.expiresAt).toEqual(extended);
      expect(session.lastUsedAt).toEqual(reference);
    });
  });
});
