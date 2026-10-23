import { RefreshTokenStatus, UserRole } from '@constants/enums';
import { MAX_REFRESH_TOKEN_SUCCESSOR_HOPS } from '@constants/auth';
import { AuthSession } from '@modules/user/entities/AuthSession';
import { RefreshToken } from '@modules/user/entities/RefreshToken';
import { User } from '@modules/user/entities/User';
import { UserNotFoundError } from '@modules/user/errors';
import { AuthSessionsRepository } from '@modules/user/repositories/contracts/auth-session.repository';
import { RefreshTokensRepository } from '@modules/user/repositories/contracts/refresh-token.repository';
import { UserRepository } from '@modules/user/repositories/contracts/user.repository';
import { AuthTokenPairFactory } from '@modules/user/services/auth-token-pair.factory';
import { WorkspaceUser } from '@modules/workspace/entities/WorkspaceUser';
import { WorkspaceUserRepository } from '@modules/workspace/repositories/contracts/WorkspaceUserRepository';
import { RefreshTokenGenerator } from '@providers/cryptography/contracts/RefreshTokenGenerator';
import { Logger } from '@nestjs/common';
import { TokenHasher } from '@providers/cryptography/contracts/TokenHasher';
import { DateProvider } from '@providers/date/contracts/DateProvider';
import { right } from '@shared/core/errors/Either';
import { SessionExpiredError } from '@shared/errors/SessionExpiredError';
import { RefreshTokenService } from './refresh-token.service';

jest.mock('@infra/env', () => ({ env: { USER_REFRESH_EXPIRES_IN: 7 } }));

const USER_ID = '10000000-0000-4000-8000-000000000000';
const FUTURE = new Date(Date.now() + 604800000);
const PAST = new Date(Date.now() - 1000);
const NOW = new Date();
const INSIDE_GRACE = new Date(NOW.getTime() - 10_000);
const OUTSIDE_GRACE = new Date(NOW.getTime() - 61_000);

function makeUser(): User {
  const result = User.create(
    { name: 'Test User', email: 'test@test.com', passwordHash: 'hashed' },
    USER_ID,
  );
  if (result.isLeft()) throw result.value;
  return result.value;
}

function makeWorkspaceUser(): WorkspaceUser {
  const result = WorkspaceUser.create({
    workspaceId: 'ws-1',
    userId: USER_ID,
    role: UserRole.OWNER,
    isDefault: true,
  });
  if (result.isLeft()) throw result.value;
  return result.value;
}

function makeSession(id = 'session-1'): AuthSession {
  const result = AuthSession.create(
    { userId: USER_ID, userAgent: 'jest-agent', expiresAt: FUTURE },
    id,
  );
  if (result.isLeft()) throw result.value;
  return result.value;
}

function makeStoredToken(
  overrides: Partial<Parameters<typeof RefreshToken.create>[0]> = {},
): RefreshToken {
  const result = RefreshToken.create(
    {
      sessionId: 'session-1',
      tokenHash: 'hashed-valid-token',
      expiresAt: FUTURE,
      ...overrides,
    },
    'rt-1',
  );
  if (result.isLeft()) throw result.value;
  return result.value;
}

describe('RefreshTokenService', () => {
  let service: RefreshTokenService;
  let userRepository: jest.Mocked<UserRepository>;
  let refreshTokensRepository: jest.Mocked<RefreshTokensRepository>;
  let authSessionsRepository: jest.Mocked<AuthSessionsRepository>;
  let workspaceUserRepository: jest.Mocked<WorkspaceUserRepository>;
  let authTokenPairFactory: jest.Mocked<AuthTokenPairFactory>;
  let dateProvider: jest.Mocked<DateProvider>;
  let tokenHasher: jest.Mocked<TokenHasher>;
  let refreshTokenGenerator: jest.Mocked<RefreshTokenGenerator>;

  beforeEach(() => {
    userRepository = {
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      findUniqueById: jest.fn(),
      findUniqueByEmail: jest.fn(),
    } as jest.Mocked<UserRepository>;

    refreshTokensRepository = {
      create: jest.fn(),
      findUniqueByTokenHash: jest.fn(),
      rotate: jest.fn(),
      revokeBySessionId: jest.fn(),
      delete: jest.fn(),
    } as jest.Mocked<RefreshTokensRepository>;

    authSessionsRepository = {
      create: jest.fn(),
      renew: jest.fn(),
      findUniqueById: jest.fn(),
      revoke: jest.fn(),
      delete: jest.fn(),
    } as jest.Mocked<AuthSessionsRepository>;

    workspaceUserRepository = {
      setDefaultWorkspace: jest.fn(),
      findDefaultWorkspaceByUserId: jest.fn(),
      findOwnerByWorkspaceId: jest.fn(),
      countByWorkspaceId: jest.fn(),
      addUserToWorkspace: jest.fn(),
      removeUserFromWorkspace: jest.fn(),
      updateUser: jest.fn(),
      findMembershipById: jest.fn(),
      findUsersByWorkspaceId: jest.fn(),
      findUserByWorkspaceAndUserId: jest.fn(),
    } as jest.Mocked<WorkspaceUserRepository>;

    authTokenPairFactory = {
      build: jest.fn(),
      signAccessToken: jest.fn().mockResolvedValue('head-access-token'),
    } as unknown as jest.Mocked<AuthTokenPairFactory>;

    dateProvider = {
      addDaysInCurrentDate: jest.fn().mockReturnValue(FUTURE),
      now: jest.fn().mockReturnValue(NOW),
    } as unknown as jest.Mocked<DateProvider>;

    tokenHasher = {
      hash: jest.fn((token: string) => `hashed-${token}`),
    } as jest.Mocked<TokenHasher>;

    refreshTokenGenerator = {
      generate: jest.fn(),
      successorOf: jest.fn((token: string) => `next-${token}`),
    } as jest.Mocked<RefreshTokenGenerator>;

    service = new RefreshTokenService(
      userRepository,
      refreshTokensRepository,
      authSessionsRepository,
      workspaceUserRepository,
      authTokenPairFactory,
      dateProvider,
      tokenHasher,
      refreshTokenGenerator,
    );
  });

  afterEach(() => jest.clearAllMocks());

  function arrangeSuccessMocks() {
    refreshTokensRepository.findUniqueByTokenHash.mockResolvedValue(
      makeStoredToken(),
    );
    authSessionsRepository.findUniqueById.mockResolvedValue(makeSession());
    userRepository.findUniqueById.mockResolvedValue(makeUser());
    workspaceUserRepository.findDefaultWorkspaceByUserId.mockResolvedValue({
      user: makeWorkspaceUser(),
      workspaceName: 'My WS',
    });
    authTokenPairFactory.build.mockResolvedValue(
      right({
        accessToken: 'access-token',
        rawRefreshToken: 'refresh-token',
        refreshToken: makeStoredToken(),
      }),
    );
    refreshTokensRepository.rotate.mockResolvedValue(true);
  }

  it('should return left(SessionExpiredError) when the token is missing', async () => {
    const result = await service.execute(undefined);

    expect(result.isLeft()).toBe(true);
    expect(result.value).toBeInstanceOf(SessionExpiredError);
    expect(
      refreshTokensRepository.findUniqueByTokenHash,
    ).not.toHaveBeenCalled();
  });

  it('should return left(SessionExpiredError) when the token is not stored', async () => {
    refreshTokensRepository.findUniqueByTokenHash.mockResolvedValue(null);

    const result = await service.execute('unknown-token');

    expect(result.isLeft()).toBe(true);
    expect(result.value).toBeInstanceOf(SessionExpiredError);
    expect(authSessionsRepository.findUniqueById).not.toHaveBeenCalled();
  });

  it('should return left(SessionExpiredError) when the session is not found', async () => {
    refreshTokensRepository.findUniqueByTokenHash.mockResolvedValue(
      makeStoredToken(),
    );
    authSessionsRepository.findUniqueById.mockResolvedValue(null);

    const result = await service.execute('valid-token');

    expect(result.isLeft()).toBe(true);
    expect(result.value).toBeInstanceOf(SessionExpiredError);
  });

  it('should return left(SessionExpiredError) when the token is expired', async () => {
    refreshTokensRepository.findUniqueByTokenHash.mockResolvedValue(
      makeStoredToken({ expiresAt: PAST }),
    );
    authSessionsRepository.findUniqueById.mockResolvedValue(makeSession());

    const result = await service.execute('expired-token');

    expect(result.isLeft()).toBe(true);
    expect(result.value).toBeInstanceOf(SessionExpiredError);
    expect(refreshTokensRepository.rotate).not.toHaveBeenCalled();
  });

  it('should return left(SessionExpiredError) when the session is revoked', async () => {
    const session = makeSession();
    session.revoke();
    refreshTokensRepository.findUniqueByTokenHash.mockResolvedValue(
      makeStoredToken(),
    );
    authSessionsRepository.findUniqueById.mockResolvedValue(session);

    const result = await service.execute('valid-token');

    expect(result.isLeft()).toBe(true);
    expect(result.value).toBeInstanceOf(SessionExpiredError);
  });

  it('should return left(UserNotFoundError) when the user is not found', async () => {
    refreshTokensRepository.findUniqueByTokenHash.mockResolvedValue(
      makeStoredToken(),
    );
    authSessionsRepository.findUniqueById.mockResolvedValue(makeSession());
    userRepository.findUniqueById.mockResolvedValue(null);

    const result = await service.execute('valid-token');

    expect(result.isLeft()).toBe(true);
    expect(result.value).toBeInstanceOf(UserNotFoundError);
  });

  it('should return left(SessionExpiredError) when the default workspace is not found', async () => {
    refreshTokensRepository.findUniqueByTokenHash.mockResolvedValue(
      makeStoredToken(),
    );
    authSessionsRepository.findUniqueById.mockResolvedValue(makeSession());
    userRepository.findUniqueById.mockResolvedValue(makeUser());
    workspaceUserRepository.findDefaultWorkspaceByUserId.mockResolvedValue(
      null,
    );

    const result = await service.execute('valid-token');

    expect(result.isLeft()).toBe(true);
    expect(result.value).toBeInstanceOf(SessionExpiredError);
  });

  it('should revoke only the reused token family', async () => {
    const rotated = makeStoredToken({ status: RefreshTokenStatus.ROTATED });
    refreshTokensRepository.findUniqueByTokenHash.mockResolvedValue(rotated);
    authSessionsRepository.findUniqueById.mockResolvedValue(makeSession());

    const result = await service.execute('reused-token');

    expect(result.isLeft()).toBe(true);
    expect(result.value).toBeInstanceOf(SessionExpiredError);
    expect(refreshTokensRepository.revokeBySessionId).toHaveBeenCalledWith(
      'session-1',
    );
    expect(authSessionsRepository.revoke).toHaveBeenCalledWith('session-1');
    expect(authTokenPairFactory.build).not.toHaveBeenCalled();
  });

  it('should revoke the family when a revoked token is presented', async () => {
    const revoked = makeStoredToken({ status: RefreshTokenStatus.REVOKED });
    refreshTokensRepository.findUniqueByTokenHash.mockResolvedValue(revoked);
    authSessionsRepository.findUniqueById.mockResolvedValue(makeSession());

    const result = await service.execute('reused-token');

    expect(result.isLeft()).toBe(true);
    expect(refreshTokensRepository.revokeBySessionId).toHaveBeenCalledWith(
      'session-1',
    );
  });

  it('should rotate the token and keep the same session on success', async () => {
    arrangeSuccessMocks();

    const result = await service.execute('valid-token');

    expect(result.isRight()).toBe(true);
    if (result.isRight()) {
      expect(result.value.accessToken).toBeDefined();
      expect(result.value.refreshToken).toBeDefined();
    }

    const [current, next] = refreshTokensRepository.rotate.mock.calls[0];
    expect(current.id).toBe('rt-1');
    expect(next.sessionId).toBe('session-1');
    expect(authSessionsRepository.renew).toHaveBeenCalledTimes(1);
  });

  it('should build the new token pair on the existing session', async () => {
    arrangeSuccessMocks();

    await service.execute('valid-token');

    expect(authTokenPairFactory.build).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: USER_ID,
        workspaceId: 'ws-1',
        sessionId: 'session-1',
      }),
    );
  });

  it('should derive the successor from the presented token', async () => {
    arrangeSuccessMocks();

    await service.execute('valid-token');

    expect(authTokenPairFactory.build).toHaveBeenCalledWith(
      expect.objectContaining({ rawRefreshToken: 'next-valid-token' }),
    );
  });

  describe('reuse grace window', () => {
    function arrangeRotated(rotatedAt: Date | null, session = makeSession()) {
      refreshTokensRepository.findUniqueByTokenHash.mockImplementation(
        async (hash) => {
          if (hash === 'hashed-old')
            return makeRotatedToken('hashed-old', rotatedAt);
          if (hash === 'hashed-next-old') return makeActiveToken(hash);
          return null;
        },
      );
      authSessionsRepository.findUniqueById.mockResolvedValue(session);
      userRepository.findUniqueById.mockResolvedValue(makeUser());
      workspaceUserRepository.findDefaultWorkspaceByUserId.mockResolvedValue({
        user: makeWorkspaceUser(),
        workspaceName: 'My WS',
      });
    }

    function makeRotatedToken(tokenHash: string, rotatedAt: Date | null) {
      return makeStoredToken({
        tokenHash,
        status: RefreshTokenStatus.ROTATED,
        rotatedAt,
      });
    }

    function makeActiveToken(tokenHash: string) {
      return makeStoredToken({ tokenHash });
    }

    it('should return the successor token when a token rotated inside the grace window is presented', async () => {
      arrangeRotated(INSIDE_GRACE);

      const result = await service.execute('old');

      expect(result.isRight()).toBe(true);
      expect(result.value).toEqual({
        accessToken: 'head-access-token',
        refreshToken: 'next-old',
      });
      expect(refreshTokensRepository.rotate).not.toHaveBeenCalled();
      expect(authSessionsRepository.renew).not.toHaveBeenCalled();
      expect(refreshTokensRepository.revokeBySessionId).not.toHaveBeenCalled();
    });

    it('should revoke the family when a token rotated outside the grace window is presented', async () => {
      arrangeRotated(OUTSIDE_GRACE);

      const result = await service.execute('old');

      expect(result.isLeft()).toBe(true);
      expect(refreshTokensRepository.revokeBySessionId).toHaveBeenCalledWith(
        'session-1',
      );
      expect(authSessionsRepository.revoke).toHaveBeenCalledWith('session-1');
    });

    it('should log the user and the seconds since rotation when revoking after the grace window', async () => {
      const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
      arrangeRotated(OUTSIDE_GRACE);

      await service.execute('old');

      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining(
          `userId=${USER_ID} reason=reuse_after_grace secondsSinceRotation=61`,
        ),
      );
    });

    it('should revoke the family when a rotated token without rotatedAt is presented', async () => {
      arrangeRotated(null);

      const result = await service.execute('old');

      expect(result.isLeft()).toBe(true);
      expect(refreshTokensRepository.revokeBySessionId).toHaveBeenCalledWith(
        'session-1',
      );
    });

    it('should reject a token rotated inside the grace window after logout', async () => {
      const session = makeSession();
      session.revoke();
      arrangeRotated(INSIDE_GRACE, session);

      const result = await service.execute('old');

      expect(result.isLeft()).toBe(true);
      expect(result.value).toBeInstanceOf(SessionExpiredError);
      expect(authTokenPairFactory.signAccessToken).not.toHaveBeenCalled();
    });

    it('should return the current head when the successor was rotated inside the grace window', async () => {
      arrangeRotated(INSIDE_GRACE);
      refreshTokensRepository.findUniqueByTokenHash.mockImplementation(
        async (hash) => {
          if (hash === 'hashed-old')
            return makeRotatedToken(hash, INSIDE_GRACE);
          if (hash === 'hashed-next-old')
            return makeRotatedToken(hash, INSIDE_GRACE);
          if (hash === 'hashed-next-next-old') return makeActiveToken(hash);
          return null;
        },
      );

      const result = await service.execute('old');

      expect(result.value).toEqual({
        accessToken: 'head-access-token',
        refreshToken: 'next-next-old',
      });
    });

    it('should revoke the family when the successor chain is broken', async () => {
      arrangeRotated(INSIDE_GRACE);
      refreshTokensRepository.findUniqueByTokenHash.mockImplementation(
        async (hash) =>
          hash === 'hashed-old' ? makeRotatedToken(hash, INSIDE_GRACE) : null,
      );

      const result = await service.execute('old');

      expect(result.isLeft()).toBe(true);
      expect(refreshTokensRepository.revokeBySessionId).toHaveBeenCalledWith(
        'session-1',
      );
    });

    it('should revoke the family when the successor chain exceeds the maximum hops', async () => {
      arrangeRotated(INSIDE_GRACE);
      refreshTokensRepository.findUniqueByTokenHash.mockImplementation(
        async (hash) => makeRotatedToken(hash, INSIDE_GRACE),
      );

      const result = await service.execute('old');

      expect(result.isLeft()).toBe(true);
      expect(
        refreshTokensRepository.findUniqueByTokenHash,
      ).toHaveBeenCalledTimes(1 + MAX_REFRESH_TOKEN_SUCCESSOR_HOPS);
      expect(refreshTokensRepository.revokeBySessionId).toHaveBeenCalledWith(
        'session-1',
      );
    });

    it('should revoke the family when the successor belongs to another session', async () => {
      arrangeRotated(INSIDE_GRACE);
      refreshTokensRepository.findUniqueByTokenHash.mockImplementation(
        async (hash) =>
          hash === 'hashed-old'
            ? makeRotatedToken(hash, INSIDE_GRACE)
            : makeStoredToken({ tokenHash: hash, sessionId: 'session-2' }),
      );

      const result = await service.execute('old');

      expect(result.isLeft()).toBe(true);
      expect(refreshTokensRepository.revokeBySessionId).toHaveBeenCalledWith(
        'session-1',
      );
    });

    it('should return the successor when the rotation loses the race', async () => {
      arrangeSuccessMocks();
      refreshTokensRepository.rotate.mockResolvedValue(false);
      refreshTokensRepository.findUniqueByTokenHash
        .mockResolvedValueOnce(makeActiveToken('hashed-valid-token'))
        .mockResolvedValueOnce(
          makeRotatedToken('hashed-valid-token', INSIDE_GRACE),
        )
        .mockResolvedValueOnce(makeActiveToken('hashed-next-valid-token'));

      const result = await service.execute('valid-token');

      expect(result.value).toEqual({
        accessToken: 'head-access-token',
        refreshToken: 'next-valid-token',
      });
      expect(refreshTokensRepository.revokeBySessionId).not.toHaveBeenCalled();
      expect(authSessionsRepository.renew).not.toHaveBeenCalled();
    });

    it('should reject when the rotation loses the race to a revocation', async () => {
      arrangeSuccessMocks();
      refreshTokensRepository.rotate.mockResolvedValue(false);
      refreshTokensRepository.findUniqueByTokenHash
        .mockResolvedValueOnce(makeActiveToken('hashed-valid-token'))
        .mockResolvedValueOnce(
          makeStoredToken({ status: RefreshTokenStatus.REVOKED }),
        );

      const result = await service.execute('valid-token');

      expect(result.isLeft()).toBe(true);
      expect(result.value).toBeInstanceOf(SessionExpiredError);
      expect(authSessionsRepository.renew).not.toHaveBeenCalled();
    });
  });
});
