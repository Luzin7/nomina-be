import { UserRole } from '@constants/enums';
import { User } from '@modules/user/entities/User';
import {
  InvalidUserAgentError,
  WrongCredentialsError,
} from '@modules/user/errors';
import { UserRepository } from '@modules/user/repositories/contracts/user.repository';
import { IssueAuthSessionService } from '@modules/user/services/issue-auth-session.service';
import { WorkspaceUser } from '@modules/workspace/entities/WorkspaceUser';
import { WorkspaceUserRepository } from '@modules/workspace/repositories/contracts/WorkspaceUserRepository';
import { HashComparer } from '@providers/cryptography/contracts/HashComparer';
import { right } from '@shared/core/errors/Either';
import { UnauthorizedError } from '@shared/errors/UnauthorizedError';
import { LoginUserService } from './login-user.service';

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
  let issueAuthSessionService: jest.Mocked<IssueAuthSessionService>;
  let hashComparer: jest.Mocked<HashComparer>;

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

    issueAuthSessionService = {
      execute: jest.fn(),
    } as unknown as jest.Mocked<IssueAuthSessionService>;

    hashComparer = { compare: jest.fn() } as jest.Mocked<HashComparer>;

    service = new LoginUserService(
      userRepository,
      workspaceUserRepository,
      issueAuthSessionService,
      hashComparer,
    );
  });

  afterEach(() => jest.clearAllMocks());

  function arrangeSuccessMocks() {
    userRepository.findUniqueByEmail.mockResolvedValue(makeUser());
    hashComparer.compare.mockResolvedValue(true);
    workspaceUserRepository.findDefaultWorkspaceByUserId.mockResolvedValue(
      makeWorkspaceUser(),
    );
    issueAuthSessionService.execute.mockResolvedValue(
      right({ accessToken: 'access-token', refreshToken: 'refresh-token' }),
    );
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
    expect(issueAuthSessionService.execute).not.toHaveBeenCalled();
  });

  it('should return right with the tokens issued by the shared service', async () => {
    arrangeSuccessMocks();

    const result = await service.execute(makeRequest());
    expect(result.isRight()).toBe(true);
    if (result.isRight()) {
      expect(result.value.accessToken).toBeDefined();
      expect(result.value.refreshToken).toBeDefined();
    }
  });

  it('should issue the session with workspace data and user agent', async () => {
    arrangeSuccessMocks();

    await service.execute(makeRequest({ agent: 'jest-agent' }));

    expect(issueAuthSessionService.execute).toHaveBeenCalledWith({
      userId: 'user-1',
      userName: 'John Doe',
      workspaceId: 'ws-1',
      workspaceName: 'My WS',
      role: UserRole.OWNER,
      userAgent: 'jest-agent',
    });
  });

  it('should return left when the user agent is blank', async () => {
    const result = await service.execute(makeRequest({ agent: '   ' }));

    expect(result.isLeft()).toBe(true);
    expect(result.value).toBeInstanceOf(InvalidUserAgentError);
    expect(issueAuthSessionService.execute).not.toHaveBeenCalled();
  });
});
