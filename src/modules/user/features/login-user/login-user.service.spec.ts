import { UserRole } from '@constants/enums';
import { User } from '@modules/user/entities/User';
import { WrongCredentialsError } from '@modules/user/errors';
import { RefreshTokensRepository } from '@modules/user/repositories/contracts/refresh-token.repository';
import { UserRepository } from '@modules/user/repositories/contracts/user.repository';
import { WorkspaceUser } from '@modules/workspace/entities/WorkspaceUser';
import { WorkspaceUserRepository } from '@modules/workspace/repositories/contracts/WorkspaceUserRepository';
import { Encrypter } from '@providers/cryptography/contracts/Encrypter';
import { HashComparer } from '@providers/cryptography/contracts/HashComparer';
import { DateProvider } from '@providers/date/contracts/DateProvider';
import { UnauthorizedError } from '@shared/errors/UnauthorizedError';
import { LoginUserService } from './login-user.service';

jest.mock('@infra/env', () => ({
  env: {
    JWT_USER_ACCESS_EXPIRES_IN: '15m',
    JWT_USER_REFRESH_EXPIRES_IN: '7d',
    USER_REFRESH_EXPIRES_IN: 7,
  },
}));

function makeRequest(overrides = {}) {
  return { email: 'john@example.com', password: 'secret123', ...overrides };
}

function makeUser(): User {
  const result = User.create(
    { name: 'John Doe', email: 'john@example.com', passwordHash: 'hash' },
    'user-1',
  );
  if (result.isLeft()) throw result.value;
  return result.value;
}

function makeWorkspaceUser() {
  const result = WorkspaceUser.create(
    {
      userId: 'user-1',
      workspaceId: 'ws-1',
      role: UserRole.OWNER,
      isDefault: true,
    },
    'wu-1',
  );
  if (result.isLeft()) throw result.value;
  return { user: result.value, workspaceName: 'My WS' };
}

describe('LoginUserService', () => {
  let service: LoginUserService;
  let userRepository: jest.Mocked<UserRepository>;
  let workspaceUserRepository: jest.Mocked<WorkspaceUserRepository>;
  let refreshTokensRepository: jest.Mocked<RefreshTokensRepository>;
  let hashComparer: jest.Mocked<HashComparer>;
  let encrypter: jest.Mocked<Encrypter>;
  let dateProvider: jest.Mocked<DateProvider>;

  beforeEach(() => {
    userRepository = {
      findUniqueByEmail: jest.fn(),
      findUniqueById: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    } as jest.Mocked<UserRepository>;
    workspaceUserRepository = {
      findDefaultWorkspaceByUserId: jest.fn(),
      setDefaultWorkspace: jest.fn(),
      findOwnerByWorkspaceId: jest.fn(),
      countByWorkspaceId: jest.fn(),
      addUserToWorkspace: jest.fn(),
      removeUserFromWorkspace: jest.fn(),
      updateUser: jest.fn(),
      findMembershipById: jest.fn(),
      findUsersByWorkspaceId: jest.fn(),
      findUserByWorkspaceAndUserId: jest.fn(),
    } as jest.Mocked<WorkspaceUserRepository>;
    refreshTokensRepository = {
      create: jest.fn(),
      findUniqueByUserIdAndToken: jest.fn(),
      delete: jest.fn(),
      deleteManyByUserId: jest.fn(),
    } as jest.Mocked<RefreshTokensRepository>;
    hashComparer = { compare: jest.fn() } as jest.Mocked<HashComparer>;
    encrypter = {
      encrypt: jest.fn().mockResolvedValue('token'),
    } as jest.Mocked<Encrypter>;
    dateProvider = {
      addDaysInCurrentDate: jest
        .fn()
        .mockReturnValue(new Date(Date.now() + 86400000 * 7)),
      now: jest.fn(),
      add: jest.fn(),
      format: jest.fn(),
      toTimezone: jest.fn(),
      calculateInvoiceCycle: jest.fn(),
      parse: jest.fn(),
      startOfDay: jest.fn(),
      endOfDay: jest.fn(),
      startOfMonth: jest.fn(),
      endOfMonth: jest.fn(),
    } as jest.Mocked<DateProvider>;

    service = new LoginUserService(
      userRepository,
      workspaceUserRepository,
      refreshTokensRepository,
      hashComparer,
      encrypter,
      dateProvider,
    );
  });

  afterEach(() => jest.clearAllMocks());

  function arrangeSuccessMocks() {
    userRepository.findUniqueByEmail.mockResolvedValue(makeUser());
    hashComparer.compare.mockResolvedValue(true);
    workspaceUserRepository.findDefaultWorkspaceByUserId.mockResolvedValue(
      makeWorkspaceUser(),
    );
    refreshTokensRepository.deleteManyByUserId.mockResolvedValue();
    refreshTokensRepository.create.mockResolvedValue();
  }

  it('should return left(WrongCredentialsError) when user is not found', async () => {
    userRepository.findUniqueByEmail.mockResolvedValue(null);

    const result = await service.execute(makeRequest());
    expect(result.isLeft()).toBe(true);
    expect(result.value).toBeInstanceOf(WrongCredentialsError);
  });

  it('should return left(WrongCredentialsError) when password is wrong', async () => {
    userRepository.findUniqueByEmail.mockResolvedValue(makeUser());
    hashComparer.compare.mockResolvedValue(false);

    const result = await service.execute(makeRequest());
    expect(result.isLeft()).toBe(true);
    expect(result.value).toBeInstanceOf(WrongCredentialsError);
  });

  it('should return left(UnauthorizedError) when no default workspace is found', async () => {
    userRepository.findUniqueByEmail.mockResolvedValue(makeUser());
    hashComparer.compare.mockResolvedValue(true);
    workspaceUserRepository.findDefaultWorkspaceByUserId.mockResolvedValue(
      null,
    );

    const result = await service.execute(makeRequest());
    expect(result.isLeft()).toBe(true);
    expect(result.value).toBeInstanceOf(UnauthorizedError);
  });

  it('should return right with accessToken and refreshToken on success', async () => {
    arrangeSuccessMocks();

    const result = await service.execute(makeRequest());
    expect(result.isRight()).toBe(true);
    if (result.isRight()) {
      expect(result.value.accessToken).toBeDefined();
      expect(result.value.refreshToken).toBeDefined();
    }
  });

  it('should delete old tokens before creating the new one', async () => {
    arrangeSuccessMocks();
    const order: string[] = [];
    refreshTokensRepository.deleteManyByUserId.mockImplementation(async () => {
      order.push('delete');
    });
    refreshTokensRepository.create.mockImplementation(async () => {
      order.push('create');
    });

    await service.execute(makeRequest());

    expect(order).toEqual(['delete', 'create']);
  });

  it('should not create a refresh token when default workspace is not found', async () => {
    userRepository.findUniqueByEmail.mockResolvedValue(makeUser());
    hashComparer.compare.mockResolvedValue(true);
    workspaceUserRepository.findDefaultWorkspaceByUserId.mockResolvedValue(
      null,
    );
    refreshTokensRepository.deleteManyByUserId.mockResolvedValue();

    await service.execute(makeRequest());

    expect(refreshTokensRepository.create).not.toHaveBeenCalled();
  });

  it('should encrypt access token with workspace payload', async () => {
    arrangeSuccessMocks();
    encrypter.encrypt
      .mockResolvedValueOnce('refresh-token-value')
      .mockResolvedValueOnce('access-token-value');

    await service.execute(makeRequest());

    const accessTokenCall = encrypter.encrypt.mock.calls.find(
      ([payload]) => 'workspaceId' in payload,
    );
    expect(accessTokenCall).toBeDefined();
    expect(accessTokenCall![0]).toMatchObject({
      sub: 'user-1',
      workspaceId: 'ws-1',
      role: UserRole.OWNER,
    });
  });
});
