import { RefreshTokenStatus, UserRole } from '@constants/enums';
import { Encrypter } from '@providers/cryptography/contracts/Encrypter';
import { TokenHasher } from '@providers/cryptography/contracts/TokenHasher';
import { AuthTokenPairFactory } from './auth-token-pair.factory';

jest.mock('@infra/env', () => ({
  env: {
    JWT_USER_ACCESS_EXPIRES_IN: '15m',
    JWT_USER_REFRESH_EXPIRES_IN: '7d',
  },
}));

const FUTURE = new Date(Date.now() + 604800000);

function makeInput(
  overrides: Partial<
    Parameters<typeof AuthTokenPairFactory.prototype.build>[0]
  > = {},
) {
  return {
    userId: 'user-1',
    userName: 'John Doe',
    workspaceId: 'ws-1',
    workspaceName: 'My WS',
    role: UserRole.OWNER,
    sessionId: 'session-1',
    expiresAt: FUTURE,
    rawRefreshToken: 'raw-refresh',
    ...overrides,
  };
}

describe('AuthTokenPairFactory', () => {
  let factory: AuthTokenPairFactory;
  let encrypter: jest.Mocked<Encrypter>;
  let tokenHasher: jest.Mocked<TokenHasher>;

  beforeEach(() => {
    encrypter = {
      encrypt: jest.fn().mockResolvedValue('signed-access'),
    } as jest.Mocked<Encrypter>;
    tokenHasher = {
      hash: jest.fn((token: string) => `hashed-${token}`),
    } as jest.Mocked<TokenHasher>;

    factory = new AuthTokenPairFactory(encrypter, tokenHasher);
  });

  afterEach(() => jest.clearAllMocks());

  it('should sign the access token with the workspace payload', async () => {
    await factory.build(makeInput());

    const accessCall = encrypter.encrypt.mock.calls.find(
      ([payload]) => 'workspaceId' in payload,
    );
    expect(accessCall).toBeDefined();
    expect(accessCall![0]).toMatchObject({
      sub: 'user-1',
      workspaceId: 'ws-1',
      role: UserRole.OWNER,
    });
  });

  it('should build an active refresh token bound to the session', async () => {
    const result = await factory.build(makeInput());

    expect(result.isRight()).toBe(true);
    if (result.isRight()) {
      expect(result.value.refreshToken.sessionId).toBe('session-1');
      expect(result.value.refreshToken.status).toBe(RefreshTokenStatus.ACTIVE);
      expect(result.value.refreshToken.expiresAt).toEqual(FUTURE);
    }
  });

  it('should return the raw refresh token alongside the access token', async () => {
    const result = await factory.build(makeInput());

    expect(result.isRight()).toBe(true);
    if (result.isRight()) {
      expect(result.value.accessToken).toBe('signed-access');
      expect(result.value.rawRefreshToken).toBe('raw-refresh');
    }
  });

  it('should hash the given raw refresh token', async () => {
    const result = await factory.build(makeInput());

    expect(tokenHasher.hash).toHaveBeenCalledWith('raw-refresh');
    if (result.isRight()) {
      expect(result.value.refreshToken.tokenHash).toBe('hashed-raw-refresh');
    }
  });

  it('should return left when the token hash is empty', async () => {
    tokenHasher.hash.mockReturnValue('');

    const result = await factory.build(makeInput());

    expect(result.isLeft()).toBe(true);
  });
});
