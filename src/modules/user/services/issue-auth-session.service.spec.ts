import { UserRole } from '@constants/enums';
import { AuthSession } from '@modules/user/entities/AuthSession';
import { RefreshToken } from '@modules/user/entities/RefreshToken';
import { MissingRefreshTokenHashError } from '@modules/user/errors';
import { AuthSessionsRepository } from '@modules/user/repositories/contracts/auth-session.repository';
import { RefreshTokensRepository } from '@modules/user/repositories/contracts/refresh-token.repository';
import { AuthTokenPairFactory } from '@modules/user/services/auth-token-pair.factory';
import { RefreshTokenGenerator } from '@providers/cryptography/contracts/RefreshTokenGenerator';
import { DateProvider } from '@providers/date/contracts/DateProvider';
import { left, right } from '@shared/core/errors/Either';
import {
  IssueAuthSessionRequest,
  IssueAuthSessionService,
} from './issue-auth-session.service';

jest.mock('@infra/env', () => ({ env: { USER_REFRESH_EXPIRES_IN: 7 } }));

const USER_ID = '10000000-0000-4000-8000-000000000000';
const FUTURE = new Date(Date.now() + 604800000);

function makeSession(id = 'session-1'): AuthSession {
  const result = AuthSession.create(
    { userId: USER_ID, userAgent: 'jest-agent', expiresAt: FUTURE },
    id,
  );
  if (result.isLeft()) throw result.value;
  return result.value;
}

function makeRefreshToken(): RefreshToken {
  const result = RefreshToken.create(
    {
      tokenHash: 'hashed-raw-token',
      sessionId: 'session-1',
      expiresAt: FUTURE,
    },
    'rt-1',
  );
  if (result.isLeft()) throw result.value;
  return result.value;
}

function makeRequest(
  overrides: Partial<IssueAuthSessionRequest> = {},
): IssueAuthSessionRequest {
  return {
    userId: USER_ID,
    userName: 'John Doe',
    workspaceId: 'ws-1',
    workspaceName: 'My WS',
    role: UserRole.OWNER,
    userAgent: 'jest-agent',
    ...overrides,
  };
}

describe('IssueAuthSessionService', () => {
  let service: IssueAuthSessionService;
  let authSessionsRepository: jest.Mocked<AuthSessionsRepository>;
  let refreshTokensRepository: jest.Mocked<RefreshTokensRepository>;
  let authTokenPairFactory: jest.Mocked<AuthTokenPairFactory>;
  let dateProvider: jest.Mocked<DateProvider>;
  let refreshTokenGenerator: jest.Mocked<RefreshTokenGenerator>;

  beforeEach(() => {
    authSessionsRepository = {
      create: jest.fn(),
      renew: jest.fn(),
      findUniqueById: jest.fn(),
      revoke: jest.fn(),
      delete: jest.fn(),
    } as jest.Mocked<AuthSessionsRepository>;

    refreshTokensRepository = {
      create: jest.fn(),
      findUniqueByTokenHash: jest.fn(),
      rotate: jest.fn(),
      revokeBySessionId: jest.fn(),
      delete: jest.fn(),
    } as jest.Mocked<RefreshTokensRepository>;

    authTokenPairFactory = {
      build: jest.fn(),
    } as unknown as jest.Mocked<AuthTokenPairFactory>;

    dateProvider = {
      addDaysInCurrentDate: jest.fn().mockReturnValue(FUTURE),
    } as unknown as jest.Mocked<DateProvider>;

    refreshTokenGenerator = {
      generate: jest.fn().mockReturnValue('generated-token'),
      successorOf: jest.fn(),
    } as jest.Mocked<RefreshTokenGenerator>;

    service = new IssueAuthSessionService(
      authSessionsRepository,
      refreshTokensRepository,
      authTokenPairFactory,
      dateProvider,
      refreshTokenGenerator,
    );
  });

  afterEach(() => jest.clearAllMocks());

  it('should create the session and persist the token built by the factory', async () => {
    const token = makeRefreshToken();
    authSessionsRepository.create.mockResolvedValue(makeSession());
    authTokenPairFactory.build.mockResolvedValue(
      right({
        accessToken: 'access',
        rawRefreshToken: 'refresh',
        refreshToken: token,
      }),
    );

    const result = await service.execute(makeRequest());

    expect(result.isRight()).toBe(true);
    expect(authSessionsRepository.create).toHaveBeenCalledTimes(1);
    expect(refreshTokensRepository.create).toHaveBeenCalledWith(token);
  });

  it('should build the token pair bound to the created session', async () => {
    authSessionsRepository.create.mockResolvedValue(makeSession('session-42'));
    authTokenPairFactory.build.mockResolvedValue(
      right({
        accessToken: 'access',
        rawRefreshToken: 'refresh',
        refreshToken: makeRefreshToken(),
      }),
    );

    await service.execute(makeRequest());

    expect(authTokenPairFactory.build).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: 'session-42', expiresAt: FUTURE }),
    );
  });

  it('should issue a generated refresh token', async () => {
    authSessionsRepository.create.mockResolvedValue(makeSession());
    authTokenPairFactory.build.mockResolvedValue(
      right({
        accessToken: 'access',
        rawRefreshToken: 'generated-token',
        refreshToken: makeRefreshToken(),
      }),
    );

    await service.execute(makeRequest());

    expect(authTokenPairFactory.build).toHaveBeenCalledWith(
      expect.objectContaining({ rawRefreshToken: 'generated-token' }),
    );
  });

  it('should return the access token and the raw refresh token', async () => {
    authSessionsRepository.create.mockResolvedValue(makeSession());
    authTokenPairFactory.build.mockResolvedValue(
      right({
        accessToken: 'access-token',
        rawRefreshToken: 'refresh-token',
        refreshToken: makeRefreshToken(),
      }),
    );

    const result = await service.execute(makeRequest());

    expect(result.isRight()).toBe(true);
    if (result.isRight()) {
      expect(result.value).toEqual({
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
      });
    }
  });

  it('should return left and not persist when the session is invalid', async () => {
    const result = await service.execute(makeRequest({ userId: '' }));

    expect(result.isLeft()).toBe(true);
    expect(authSessionsRepository.create).not.toHaveBeenCalled();
    expect(refreshTokensRepository.create).not.toHaveBeenCalled();
  });

  it('should return left when the factory cannot build the tokens', async () => {
    authSessionsRepository.create.mockResolvedValue(makeSession());
    authTokenPairFactory.build.mockResolvedValue(
      left(new MissingRefreshTokenHashError()),
    );

    const result = await service.execute(makeRequest());

    expect(result.isLeft()).toBe(true);
    expect(refreshTokensRepository.create).not.toHaveBeenCalled();
  });
});
