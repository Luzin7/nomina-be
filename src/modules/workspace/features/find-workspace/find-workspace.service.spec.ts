import { UserRole } from '@constants/enums';
import { Workspace } from '@modules/workspace/entities/Workspace';
import { WorkspaceUser } from '@modules/workspace/entities/WorkspaceUser';
import { WorkspaceNotFoundError } from '@modules/workspace/errors';
import { WorkspaceRepository } from '@modules/workspace/repositories/contracts/WorkspaceRepository';
import { WorkspaceUserRepository } from '@modules/workspace/repositories/contracts/WorkspaceUserRepository';
import { UnauthorizedError } from '@shared/errors/UnauthorizedError';
import { FindWorkspaceByIdService } from './find-workspace.service';

type ServiceRequest = Parameters<
  typeof FindWorkspaceByIdService.prototype.execute
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

describe('FindWorkspaceByIdService', () => {
  let service: FindWorkspaceByIdService;
  let workspaceRepository: jest.Mocked<WorkspaceRepository>;
  let workspaceUserRepository: jest.Mocked<WorkspaceUserRepository>;

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

    service = new FindWorkspaceByIdService(
      workspaceRepository,
      workspaceUserRepository,
    );
  });

  afterEach(() => jest.clearAllMocks());

  it('should return left(WorkspaceNotFoundError) when workspace not found', async () => {
    workspaceRepository.findById.mockResolvedValue(null);

    const result = await service.execute(makeRequest());
    expect(result.isLeft()).toBe(true);
    expect(result.value).toBeInstanceOf(WorkspaceNotFoundError);
  });

  it('should return left(UnauthorizedError) when user is not a member', async () => {
    workspaceRepository.findById.mockResolvedValue(makeWorkspace());
    workspaceUserRepository.findUserByWorkspaceAndUserId.mockResolvedValue(
      null,
    );

    const result = await service.execute(makeRequest());
    expect(result.isLeft()).toBe(true);
    expect(result.value).toBeInstanceOf(UnauthorizedError);
  });

  it('should return workspace and role on success', async () => {
    workspaceRepository.findById.mockResolvedValue(makeWorkspace());
    workspaceUserRepository.findUserByWorkspaceAndUserId.mockResolvedValue(
      makeWorkspaceUser(),
    );

    const result = await service.execute(makeRequest());
    expect(result.isRight()).toBe(true);
    if (result.isRight()) {
      expect(result.value.workspace).toBeDefined();
      expect(result.value.role).toBe(UserRole.OWNER);
    }
  });
});
