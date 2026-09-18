import { UserRole } from '@constants/enums';
import { Workspace } from '@modules/workspace/entities/Workspace';
import { WorkspaceUser } from '@modules/workspace/entities/WorkspaceUser';
import {
  CannotDeleteDefaultWorkspaceError,
  WorkspaceNotFoundError,
  WorkspaceUserNotFoundError,
} from '@modules/workspace/errors';
import { WorkspaceRepository } from '@modules/workspace/repositories/contracts/WorkspaceRepository';
import { WorkspaceUserRepository } from '@modules/workspace/repositories/contracts/WorkspaceUserRepository';
import { DeleteWorkspaceService } from './delete-workspace.service';

function makeRequest(overrides = {}) {
  return { workspaceId: 'ws-1', sub: 'user-1', ...overrides };
}

function makeWorkspace(): Workspace {
  const result = Workspace.create({ name: 'My WS' }, 'ws-1');
  if (result.isLeft()) throw result.value;
  return result.value;
}

function makeWorkspaceUser(isDefault = false): WorkspaceUser {
  const result = WorkspaceUser.create(
    {
      userId: 'user-1',
      workspaceId: 'ws-1',
      role: UserRole.OWNER,
      isDefault,
    },
    'wu-1',
  );
  if (result.isLeft()) throw result.value;
  return result.value;
}

describe('DeleteWorkspaceService', () => {
  let service: DeleteWorkspaceService;
  let workspaceRepository: jest.Mocked<WorkspaceRepository>;
  let workspaceUserRepository: jest.Mocked<WorkspaceUserRepository>;

  beforeEach(() => {
    workspaceRepository = {
      findById: jest.fn(),
      delete: jest.fn(),
      create: jest.fn(),
      createWithOwnerAndAccount: jest.fn(),
      update: jest.fn(),
      findTimezoneById: jest.fn(),
      findOwnedByUserId: jest.fn(),
      countOwnedByUserId: jest.fn(),
    } as jest.Mocked<WorkspaceRepository>;

    workspaceUserRepository = {
      findUserByWorkspaceAndUserId: jest.fn(),
      setDefaultWorkspace: jest.fn(),
      findDefaultWorkspaceByUserId: jest.fn(),
      findOwnerByWorkspaceId: jest.fn(),
      countByWorkspaceId: jest.fn(),
      addUserToWorkspace: jest.fn(),
      removeUserFromWorkspace: jest.fn(),
      updateUser: jest.fn(),
      findMembershipById: jest.fn(),
      findUsersByWorkspaceId: jest.fn(),
    } as jest.Mocked<WorkspaceUserRepository>;

    service = new DeleteWorkspaceService(
      workspaceRepository,
      workspaceUserRepository,
    );
  });

  afterEach(() => jest.clearAllMocks());

  it('should return left(WorkspaceNotFoundError) when workspace does not exist', async () => {
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

  it('should return left(CannotDeleteDefaultWorkspaceError) when workspace is default', async () => {
    workspaceRepository.findById.mockResolvedValue(makeWorkspace());
    workspaceUserRepository.findUserByWorkspaceAndUserId.mockResolvedValue(
      makeWorkspaceUser(true),
    );

    const result = await service.execute(makeRequest());
    expect(result.isLeft()).toBe(true);
    expect(result.value).toBeInstanceOf(CannotDeleteDefaultWorkspaceError);
  });

  it('should delete workspace and return right on success', async () => {
    workspaceRepository.findById.mockResolvedValue(makeWorkspace());
    workspaceUserRepository.findUserByWorkspaceAndUserId.mockResolvedValue(
      makeWorkspaceUser(false),
    );
    workspaceRepository.delete.mockResolvedValue();

    const result = await service.execute(makeRequest());
    expect(result.isRight()).toBe(true);
    expect(workspaceRepository.delete).toHaveBeenCalledWith('ws-1');
  });
});
