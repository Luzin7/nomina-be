import { UserRole } from '@constants/enums';
import { User } from '@modules/user/entities/User';
import { UserNotFoundError } from '@modules/user/errors';
import { RefreshTokensRepository } from '@modules/user/repositories/contracts/refresh-token.repository';
import { UserRepository } from '@modules/user/repositories/contracts/user.repository';
import { Workspace } from '@modules/workspace/entities/Workspace';
import { WorkspaceUser } from '@modules/workspace/entities/WorkspaceUser';
import {
  WorkspaceNotFoundError,
  WorkspaceUserNotFoundError,
} from '@modules/workspace/errors';
import { WorkspaceRepository } from '@modules/workspace/repositories/contracts/WorkspaceRepository';
import { WorkspaceUserRepository } from '@modules/workspace/repositories/contracts/WorkspaceUserRepository';
import { Encrypter } from '@providers/cryptography/contracts/Encrypter';
import { DateProvider } from '@providers/date/contracts/DateProvider';
import { SwitchWorkspaceService } from './switch-workspace.service';

jest.mock('@infra/env', () => ({
  env: {
    JWT_USER_ACCESS_EXPIRES_IN: '15m',
    JWT_USER_REFRESH_EXPIRES_IN: '7d',
    USER_REFRESH_EXPIRES_IN: '7',
  },
}));

type ServiceRequest = Parameters<
  typeof SwitchWorkspaceService.prototype.execute
>[0];

function makeRequest(
  overrides: Partial<Record<string, unknown>> = {},
): ServiceRequest {
  return { workspaceId: 'ws-1', sub: 'user-1', ...overrides } as ServiceRequest;
}

function makeWorkspace(): Workspace {
  const r = Workspace.create({ name: 'Test WS' }, 'ws-1');
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

function makeUser(): User {
  const r = User.create(
    { name: 'Test User', email: 'test@test.com', passwordHash: 'hashed' },
    'user-1',
  );
  if (r.isLeft()) throw r.value;
  return r.value;
}

describe('SwitchWorkspaceService', () => {
  let service: SwitchWorkspaceService;
  let workspaceRepository: jest.Mocked<WorkspaceRepository>;
  let workspaceUserRepository: jest.Mocked<WorkspaceUserRepository>;
  let userRepository: jest.Mocked<UserRepository>;
  let encrypter: jest.Mocked<Encrypter>;
  let refreshTokensRepository: jest.Mocked<RefreshTokensRepository>;
  let dateProvider: jest.Mocked<DateProvider>;

  function arrangeSuccessMocks() {
    workspaceRepository.findById.mockResolvedValue(makeWorkspace());
    workspaceUserRepository.findUserByWorkspaceAndUserId.mockResolvedValue(
      makeWorkspaceUser(),
    );
    userRepository.findUniqueById.mockResolvedValue(makeUser());
    encrypter.encrypt.mockResolvedValue('token');
    dateProvider.now.mockReturnValue(new Date());
    dateProvider.add.mockReturnValue(new Date(Date.now() + 604800000));
    refreshTokensRepository.deleteManyByUserId.mockResolvedValue();
    refreshTokensRepository.create.mockResolvedValue();
  }

  beforeEach(() => {
    workspaceRepository = {
      create: jest.fn(),
      createWithOwnerAndAccount: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      findById: jest.fn(),
      findTimezoneById: jest.fn(),
      findOwnedByUserId: jest.fn(),
      countOwnedByUserId: jest.fn(),
    } as jest.Mocked<WorkspaceRepository>;

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

    userRepository = {
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      findUniqueById: jest.fn(),
      findUniqueByEmail: jest.fn(),
    } as jest.Mocked<UserRepository>;

    encrypter = { encrypt: jest.fn() } as jest.Mocked<Encrypter>;

    refreshTokensRepository = {
      create: jest.fn(),
      findUniqueByUserIdAndToken: jest.fn(),
      delete: jest.fn(),
      deleteManyByUserId: jest.fn(),
    } as jest.Mocked<RefreshTokensRepository>;

    dateProvider = {
      now: jest.fn(),
      add: jest.fn(),
      format: jest.fn(),
      toTimezone: jest.fn(),
      calculateInvoiceCycle: jest.fn(),
      addDaysInCurrentDate: jest.fn(),
      parse: jest.fn(),
      startOfDay: jest.fn(),
      endOfDay: jest.fn(),
      startOfMonth: jest.fn(),
    } as unknown as jest.Mocked<DateProvider>;

    service = new SwitchWorkspaceService(
      workspaceRepository,
      workspaceUserRepository,
      userRepository,
      encrypter,
      refreshTokensRepository,
      dateProvider,
    );
  });

  afterEach(() => jest.clearAllMocks());

  it('should return left(WorkspaceNotFoundError) when workspace not found', async () => {
    workspaceRepository.findById.mockResolvedValue(null);

    const result = await service.execute(makeRequest());
    expect(result.isLeft()).toBe(true);
    expect(result.value).toBeInstanceOf(WorkspaceNotFoundError);
  });

  it('should return left(WorkspaceUserNotFoundError) when user is not a member', async () => {
    workspaceRepository.findById.mockResolvedValue(makeWorkspace());
    workspaceUserRepository.findUserByWorkspaceAndUserId.mockResolvedValue(
      null,
    );

    const result = await service.execute(makeRequest());
    expect(result.isLeft()).toBe(true);
    expect(result.value).toBeInstanceOf(WorkspaceUserNotFoundError);
  });

  it('should return left(UserNotFoundError) when user not found', async () => {
    workspaceRepository.findById.mockResolvedValue(makeWorkspace());
    workspaceUserRepository.findUserByWorkspaceAndUserId.mockResolvedValue(
      makeWorkspaceUser(),
    );
    userRepository.findUniqueById.mockResolvedValue(null);

    const result = await service.execute(makeRequest());
    expect(result.isLeft()).toBe(true);
    expect(result.value).toBeInstanceOf(UserNotFoundError);
  });

  it('should return new tokens on success', async () => {
    arrangeSuccessMocks();

    const result = await service.execute(makeRequest());
    expect(result.isRight()).toBe(true);
    if (result.isRight()) {
      expect(result.value.accessToken).toBeDefined();
      expect(result.value.refreshToken).toBeDefined();
    }
    expect(refreshTokensRepository.create).toHaveBeenCalledTimes(1);
  });
});
