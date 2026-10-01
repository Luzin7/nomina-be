import { UserRole } from '@constants/enums';
import { RefreshToken } from '@modules/user/entities/RefreshToken';
import { User } from '@modules/user/entities/User';
import { UserNotFoundError } from '@modules/user/errors';
import { RefreshTokensRepository } from '@modules/user/repositories/contracts/refresh-token.repository';
import { UserRepository } from '@modules/user/repositories/contracts/user.repository';
import { WorkspaceUser } from '@modules/workspace/entities/WorkspaceUser';
import { WorkspaceUserRepository } from '@modules/workspace/repositories/contracts/WorkspaceUserRepository';
import { Decoder } from '@providers/cryptography/contracts/Decoder';
import { Encrypter } from '@providers/cryptography/contracts/Encrypter';
import { DateProvider } from '@providers/date/contracts/DateProvider';
import { SessionExpiredError } from '@shared/errors/SessionExpiredError';
import { RefreshTokenService } from './refresh-token.service';

jest.mock('@infra/env', () => ({
  env: {
    JWT_USER_ACCESS_EXPIRES_IN: '15m',
    JWT_USER_REFRESH_EXPIRES_IN: '7d',
    USER_REFRESH_EXPIRES_IN: 7,
  },
}));

function makeUser(): User {
  const r = User.create(
    { name: 'Test User', email: 'test@test.com', passwordHash: 'hashed' },
    'user-1',
  );
  if (r.isLeft()) throw r.value;
  return r.value;
}

function makeRefreshToken(): RefreshToken {
  const r = RefreshToken.create(
    {
      userId: 'user-1',
      token: 'valid-token',
      expiresIn: new Date(Date.now() + 100000),
    },
    'rt-1',
  );
  if (r.isLeft()) throw r.value;
  return r.value;
}

function makeWorkspaceUser(): WorkspaceUser {
  const r = WorkspaceUser.create({
    workspaceId: 'ws-1',
    userId: 'user-1',
    role: UserRole.OWNER,
    isDefault: true,
  });
  if (r.isLeft()) throw r.value;
  return r.value;
}

describe('RefreshTokenService', () => {
  let service: RefreshTokenService;
  let userRepository: jest.Mocked<UserRepository>;
  let refreshTokensRepository: jest.Mocked<RefreshTokensRepository>;
  let decrypter: jest.Mocked<Decoder>;
  let encrypter: jest.Mocked<Encrypter>;
  let dateProvider: jest.Mocked<DateProvider>;
  let workspaceUserRepository: jest.Mocked<WorkspaceUserRepository>;

  function arrangeSuccessMocks() {
    decrypter.decrypt.mockResolvedValue({
      isValid: true,
      payload: { sub: 'user-1', workspaceId: 'ws-1', role: UserRole.OWNER },
    });
    userRepository.findUniqueById.mockResolvedValue(makeUser());
    refreshTokensRepository.findUniqueByUserIdAndToken.mockResolvedValue(
      makeRefreshToken(),
    );
    refreshTokensRepository.delete.mockResolvedValue();
    workspaceUserRepository.findDefaultWorkspaceByUserId.mockResolvedValue({
      user: makeWorkspaceUser(),
      workspaceName: 'My WS',
    });
    encrypter.encrypt.mockResolvedValue('new-token');
    dateProvider.addDaysInCurrentDate.mockReturnValue(
      new Date(Date.now() + 604800000),
    );
    refreshTokensRepository.create.mockResolvedValue();
  }

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
      findUniqueByUserIdAndToken: jest.fn(),
      delete: jest.fn(),
      deleteManyByUserId: jest.fn(),
    } as jest.Mocked<RefreshTokensRepository>;

    decrypter = { decrypt: jest.fn() } as jest.Mocked<Decoder>;
    encrypter = { encrypt: jest.fn() } as jest.Mocked<Encrypter>;

    dateProvider = {
      now: jest.fn(),
      add: jest.fn(),
      format: jest.fn(),
      toTimezone: jest.fn(),
      addDaysInCurrentDate: jest.fn(),
      parse: jest.fn(),
      startOfDay: jest.fn(),
      endOfDay: jest.fn(),
      startOfMonth: jest.fn(),
    } as unknown as jest.Mocked<DateProvider>;

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

    service = new RefreshTokenService(
      userRepository,
      refreshTokensRepository,
      decrypter,
      encrypter,
      dateProvider,
      workspaceUserRepository,
    );
  });

  afterEach(() => jest.clearAllMocks());

  it('should return left(SessionExpiredError) when token is invalid', async () => {
    decrypter.decrypt.mockResolvedValue({ isValid: false });

    const result = await service.execute('bad-token');
    expect(result.isLeft()).toBe(true);
    expect(result.value).toBeInstanceOf(SessionExpiredError);
  });

  it('should return left(UserNotFoundError) when user not found', async () => {
    decrypter.decrypt.mockResolvedValue({
      isValid: true,
      payload: { sub: 'user-1', workspaceId: 'ws-1', role: UserRole.OWNER },
    });
    userRepository.findUniqueById.mockResolvedValue(null);

    const result = await service.execute('valid-token');
    expect(result.isLeft()).toBe(true);
    expect(result.value).toBeInstanceOf(UserNotFoundError);
  });

  it('should return left(SessionExpiredError) when saved token not found', async () => {
    decrypter.decrypt.mockResolvedValue({
      isValid: true,
      payload: { sub: 'user-1', workspaceId: 'ws-1', role: UserRole.OWNER },
    });
    userRepository.findUniqueById.mockResolvedValue(makeUser());
    refreshTokensRepository.findUniqueByUserIdAndToken.mockResolvedValue(null);

    const result = await service.execute('valid-token');
    expect(result.isLeft()).toBe(true);
    expect(result.value).toBeInstanceOf(SessionExpiredError);
  });

  it('should return new tokens on success', async () => {
    arrangeSuccessMocks();

    const result = await service.execute('valid-token');
    expect(result.isRight()).toBe(true);
    if (result.isRight()) {
      expect(result.value.accessToken).toBeDefined();
      expect(result.value.refreshToken).toBeDefined();
    }
    expect(refreshTokensRepository.create).toHaveBeenCalledTimes(1);
  });
});
