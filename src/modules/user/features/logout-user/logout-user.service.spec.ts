import { RefreshToken } from '@modules/user/entities/RefreshToken';
import { AuthSessionsRepository } from '@modules/user/repositories/contracts/auth-session.repository';
import { RefreshTokensRepository } from '@modules/user/repositories/contracts/refresh-token.repository';
import { TokenHasher } from '@providers/cryptography/contracts/TokenHasher';
import { LogoutUserService } from './logout-user.service';

function makeSavedToken(): RefreshToken {
  const result = RefreshToken.create(
    {
      sessionId: 'session-1',
      tokenHash: 'hashed-valid-token',
      expiresAt: new Date(Date.now() + 100000),
    },
    'rt-1',
  );
  if (result.isLeft()) throw result.value;
  return result.value;
}

describe('LogoutUserService', () => {
  let service: LogoutUserService;
  let refreshTokensRepository: jest.Mocked<RefreshTokensRepository>;
  let authSessionsRepository: jest.Mocked<AuthSessionsRepository>;
  let tokenHasher: jest.Mocked<TokenHasher>;

  beforeEach(() => {
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

    tokenHasher = {
      hash: jest.fn((token: string) => `hashed-${token}`),
    } as jest.Mocked<TokenHasher>;

    service = new LogoutUserService(
      refreshTokensRepository,
      authSessionsRepository,
      tokenHasher,
    );
  });

  afterEach(() => jest.clearAllMocks());

  it('should revoke the session linked to the presented token', async () => {
    refreshTokensRepository.findUniqueByTokenHash.mockResolvedValue(
      makeSavedToken(),
    );

    const result = await service.execute('valid-token');

    expect(result.isRight()).toBe(true);
    expect(authSessionsRepository.revoke).toHaveBeenCalledWith('session-1');
  });

  it('should do nothing when no token is provided', async () => {
    const result = await service.execute(undefined);

    expect(result.isRight()).toBe(true);
    expect(
      refreshTokensRepository.findUniqueByTokenHash,
    ).not.toHaveBeenCalled();
    expect(authSessionsRepository.revoke).not.toHaveBeenCalled();
  });

  it('should do nothing when the token is not stored', async () => {
    refreshTokensRepository.findUniqueByTokenHash.mockResolvedValue(null);

    const result = await service.execute('rotated-token');

    expect(result.isRight()).toBe(true);
    expect(authSessionsRepository.revoke).not.toHaveBeenCalled();
  });
});
