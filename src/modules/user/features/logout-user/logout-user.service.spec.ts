import { RefreshToken } from '@modules/user/entities/RefreshToken';
import { RefreshTokensRepository } from '@modules/user/repositories/contracts/refresh-token.repository';
import { Decoder } from '@providers/cryptography/contracts/Decoder';
import { TokenHasher } from '@providers/cryptography/contracts/TokenHasher';
import { LogoutUserService } from './logout-user.service';

const USER_ID = '10000000-0000-4000-8000-000000000000';

function makeSavedToken(): RefreshToken {
  const result = RefreshToken.create(
    {
      userId: USER_ID,
      token: 'valid-token',
      expiresIn: new Date(Date.now() + 100000),
    },
    'rt-1',
  );
  if (result.isLeft()) throw result.value;
  return result.value;
}

describe('LogoutUserService', () => {
  let service: LogoutUserService;
  let refreshTokensRepository: jest.Mocked<RefreshTokensRepository>;
  let decrypter: jest.Mocked<Decoder>;
  let tokenHasher: jest.Mocked<TokenHasher>;

  beforeEach(() => {
    refreshTokensRepository = {
      findUniqueByUserIdAndToken: jest.fn(),
      replaceByToken: jest.fn(),
      replaceAllByUserId: jest.fn(),
      delete: jest.fn(),
    } as jest.Mocked<RefreshTokensRepository>;

    decrypter = { decrypt: jest.fn() } as jest.Mocked<Decoder>;
    tokenHasher = {
      hash: jest.fn((token: string) => `hashed-${token}`),
    } as jest.Mocked<TokenHasher>;

    service = new LogoutUserService(
      refreshTokensRepository,
      decrypter,
      tokenHasher,
    );
  });

  afterEach(() => jest.clearAllMocks());

  it('should revoke the presented token when it is valid and stored', async () => {
    decrypter.decrypt.mockResolvedValue({
      isValid: true,
      payload: { sub: USER_ID },
    });
    refreshTokensRepository.findUniqueByUserIdAndToken.mockResolvedValue(
      makeSavedToken(),
    );

    const result = await service.execute('valid-token');

    expect(result.isRight()).toBe(true);
    expect(refreshTokensRepository.delete).toHaveBeenCalledWith('rt-1');
  });

  it('should do nothing when no token is provided', async () => {
    const result = await service.execute(undefined);

    expect(result.isRight()).toBe(true);
    expect(decrypter.decrypt).not.toHaveBeenCalled();
    expect(refreshTokensRepository.delete).not.toHaveBeenCalled();
  });

  it('should do nothing when the token is invalid', async () => {
    decrypter.decrypt.mockResolvedValue({ isValid: false });

    const result = await service.execute('invalid-token');

    expect(result.isRight()).toBe(true);
    expect(
      refreshTokensRepository.findUniqueByUserIdAndToken,
    ).not.toHaveBeenCalled();
    expect(refreshTokensRepository.delete).not.toHaveBeenCalled();
  });

  it('should do nothing when the token is not stored', async () => {
    decrypter.decrypt.mockResolvedValue({
      isValid: true,
      payload: { sub: USER_ID },
    });
    refreshTokensRepository.findUniqueByUserIdAndToken.mockResolvedValue(null);

    const result = await service.execute('rotated-token');

    expect(result.isRight()).toBe(true);
    expect(refreshTokensRepository.delete).not.toHaveBeenCalled();
  });
});
