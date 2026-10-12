import { RefreshTokenStatus, UserRole } from '@constants/enums';
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
import { TokenHasher } from '@providers/cryptography/contracts/TokenHasher';
import { DateProvider } from '@providers/date/contracts/DateProvider';
import { right } from '@shared/core/errors/Either';
import { SessionExpiredError } from '@shared/errors/SessionExpiredError';
import { RefreshTokenService } from './refresh-token.service';

jest.mock('@infra/env', () => ({ env: { USER_REFRESH_EXPIRES_IN: 7 } }));

const USER_ID = '10000000-0000-4000-8000-000000000000';
const FUTURE = new Date(Date.now() + 604800000);
const PAST = new Date(Date.now() - 1000);

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
      save: jest.fn(),
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
    } as unknown as jest.Mocked<AuthTokenPairFactory>;

    dateProvider = {
      addDaysInCurrentDate: jest.fn().mockReturnValue(FUTURE),
    } as unknown as jest.Mocked<DateProvider>;

    tokenHasher = {
      hash: jest.fn((token: string) => `hashed-${token}`),
    } as jest.Mocked<TokenHasher>;

    service = new RefreshTokenService(
      userRepository,
      refreshTokensRepository,
      authSessionsRepository,
      workspaceUserRepository,
      authTokenPairFactory,
      dateProvider,
      tokenHasher,
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
    expect(authSessionsRepository.save).toHaveBeenCalledTimes(1);
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

  it('should revoke the family when the rotation loses the race', async () => {
    arrangeSuccessMocks();
    refreshTokensRepository.rotate.mockResolvedValue(false);

    const result = await service.execute('valid-token');

    expect(result.isLeft()).toBe(true);
    expect(result.value).toBeInstanceOf(SessionExpiredError);
    expect(refreshTokensRepository.revokeBySessionId).toHaveBeenCalledWith(
      'session-1',
    );
    expect(authSessionsRepository.save).not.toHaveBeenCalled();
  });
});
