import { UserRole } from '@constants/enums';
import { Workspace } from '@modules/workspace/entities/Workspace';
import { WorkspaceUser } from '@modules/workspace/entities/WorkspaceUser';
import { WorkspaceNotFoundError } from '@modules/workspace/errors';
import { WorkspaceRepository } from '@modules/workspace/repositories/contracts/WorkspaceRepository';
import { WorkspaceUserRepository } from '@modules/workspace/repositories/contracts/WorkspaceUserRepository';
import { WorkspaceAccessPolicy } from '@modules/workspace/services/WorkspaceAccessPolicy';
import { UnauthorizedError } from '@shared/errors/UnauthorizedError';
import { UpdateWorkspaceService } from './update-workspace.service';

type ServiceRequest = Parameters<
  typeof UpdateWorkspaceService.prototype.execute
>[0];

function makeRequest(
  overrides: Partial<Record<string, unknown>> = {},
): ServiceRequest {
  return {
    workspaceId: 'ws-1',
    sub: 'user-1',
    name: 'Updated Name',
    currency: 'BRL',
    ...overrides,
  } as ServiceRequest;
}

function makeWorkspace(): Workspace {
  const r = Workspace.create({ name: 'Original Name' }, 'ws-1');
  if (r.isLeft()) throw r.value;
  return r.value;
}

function makeMembership(role: UserRole): WorkspaceUser {
  const r = WorkspaceUser.create({
    workspaceId: 'ws-1',
    userId: 'user-1',
    role,
    isDefault: false,
  });
  if (r.isLeft()) throw r.value;
  return r.value;
}

describe('UpdateWorkspaceService', () => {
  let service: UpdateWorkspaceService;
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
      findByMemberUserId: jest.fn(),
      countOwnedByUserId: jest.fn(),
    } as jest.Mocked<WorkspaceRepository>;

    workspaceUserRepository = {
      findUserByWorkspaceAndUserId: jest.fn(),
    } as unknown as jest.Mocked<WorkspaceUserRepository>;

    service = new UpdateWorkspaceService(
      workspaceRepository,
      workspaceUserRepository,
      new WorkspaceAccessPolicy(),
    );
  });

  afterEach(() => jest.clearAllMocks());

  it('should resolve the membership of the authenticated user', async () => {
    workspaceUserRepository.findUserByWorkspaceAndUserId.mockResolvedValue(
      makeMembership(UserRole.OWNER),
    );
    workspaceRepository.findById.mockResolvedValue(makeWorkspace());
    workspaceRepository.update.mockImplementation(async (w) => w);

    await service.execute(makeRequest());

    expect(
      workspaceUserRepository.findUserByWorkspaceAndUserId,
    ).toHaveBeenCalledWith('ws-1', 'user-1');
  });

  it('should update the workspace for an OWNER', async () => {
    workspaceUserRepository.findUserByWorkspaceAndUserId.mockResolvedValue(
      makeMembership(UserRole.OWNER),
    );
    workspaceRepository.findById.mockResolvedValue(makeWorkspace());
    workspaceRepository.update.mockImplementation(async (w) => w);

    const result = await service.execute(makeRequest({ name: 'New Name' }));

    expect(result.isRight()).toBe(true);
    if (result.isRight()) expect(result.value.name).toBe('New Name');
    expect(workspaceRepository.update).toHaveBeenCalledTimes(1);
  });

  it('should update the workspace for an ADMIN', async () => {
    workspaceUserRepository.findUserByWorkspaceAndUserId.mockResolvedValue(
      makeMembership(UserRole.ADMIN),
    );
    workspaceRepository.findById.mockResolvedValue(makeWorkspace());
    workspaceRepository.update.mockImplementation(async (w) => w);

    const result = await service.execute(makeRequest());

    expect(result.isRight()).toBe(true);
    expect(workspaceRepository.update).toHaveBeenCalledTimes(1);
  });

  it('should refuse a USER member with UnauthorizedError', async () => {
    workspaceUserRepository.findUserByWorkspaceAndUserId.mockResolvedValue(
      makeMembership(UserRole.USER),
    );

    const result = await service.execute(makeRequest());

    expect(result.isLeft()).toBe(true);
    if (result.isLeft()) expect(result.value).toBeInstanceOf(UnauthorizedError);
    expect(workspaceRepository.findById).not.toHaveBeenCalled();
    expect(workspaceRepository.update).not.toHaveBeenCalled();
  });

  it('should refuse a VIEWER member with UnauthorizedError', async () => {
    workspaceUserRepository.findUserByWorkspaceAndUserId.mockResolvedValue(
      makeMembership(UserRole.VIEWER),
    );

    const result = await service.execute(makeRequest());

    expect(result.isLeft()).toBe(true);
    if (result.isLeft()) expect(result.value).toBeInstanceOf(UnauthorizedError);
    expect(workspaceRepository.findById).not.toHaveBeenCalled();
    expect(workspaceRepository.update).not.toHaveBeenCalled();
  });

  it('should refuse a non-member with UnauthorizedError', async () => {
    workspaceUserRepository.findUserByWorkspaceAndUserId.mockResolvedValue(
      null,
    );

    const result = await service.execute(makeRequest());

    expect(result.isLeft()).toBe(true);
    if (result.isLeft()) expect(result.value).toBeInstanceOf(UnauthorizedError);
    expect(workspaceRepository.findById).not.toHaveBeenCalled();
    expect(workspaceRepository.update).not.toHaveBeenCalled();
  });

  it('should answer UnauthorizedError for an unknown workspace', async () => {
    workspaceUserRepository.findUserByWorkspaceAndUserId.mockResolvedValue(
      null,
    );

    const result = await service.execute(
      makeRequest({ workspaceId: 'unknown-ws' }),
    );

    expect(result.isLeft()).toBe(true);
    if (result.isLeft()) expect(result.value).toBeInstanceOf(UnauthorizedError);
    expect(workspaceRepository.findById).not.toHaveBeenCalled();
    expect(workspaceRepository.update).not.toHaveBeenCalled();
  });

  it('should return WorkspaceNotFoundError when the workspace vanishes after the membership check', async () => {
    workspaceUserRepository.findUserByWorkspaceAndUserId.mockResolvedValue(
      makeMembership(UserRole.OWNER),
    );
    workspaceRepository.findById.mockResolvedValue(null);

    const result = await service.execute(makeRequest());

    expect(result.isLeft()).toBe(true);
    if (result.isLeft())
      expect(result.value).toBeInstanceOf(WorkspaceNotFoundError);
    expect(workspaceRepository.update).not.toHaveBeenCalled();
  });

  it('should set the cycle when the request carries one', async () => {
    workspaceUserRepository.findUserByWorkspaceAndUserId.mockResolvedValue(
      makeMembership(UserRole.OWNER),
    );
    workspaceRepository.findById.mockResolvedValue(makeWorkspace());
    workspaceRepository.update.mockImplementation(async (w) => w);

    const result = await service.execute(makeRequest({ cycle: 'half_month' }));

    expect(result.isRight()).toBe(true);
    if (result.isRight()) expect(result.value.cycle).toBe('half_month');
  });

  it('should preserve the current cycle when the request omits it', async () => {
    const workspace = makeWorkspace();
    workspace.updateDetails('Original Name', 'BRL', 'UTC', 'weekly');
    workspaceUserRepository.findUserByWorkspaceAndUserId.mockResolvedValue(
      makeMembership(UserRole.OWNER),
    );
    workspaceRepository.findById.mockResolvedValue(workspace);
    workspaceRepository.update.mockImplementation(async (w) => w);

    const result = await service.execute(makeRequest());

    expect(result.isRight()).toBe(true);
    if (result.isRight()) expect(result.value.cycle).toBe('weekly');
  });
});
