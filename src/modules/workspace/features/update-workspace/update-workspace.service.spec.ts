import { Workspace } from '@modules/workspace/entities/Workspace';
import { WorkspaceNotFoundError } from '@modules/workspace/errors';
import { WorkspaceRepository } from '@modules/workspace/repositories/contracts/WorkspaceRepository';
import { UpdateWorkspaceService } from './update-workspace.service';

type ServiceRequest = Parameters<
  typeof UpdateWorkspaceService.prototype.execute
>[0];

function makeRequest(
  overrides: Partial<Record<string, unknown>> = {},
): ServiceRequest {
  return {
    workspaceId: 'ws-1',
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

describe('UpdateWorkspaceService', () => {
  let service: UpdateWorkspaceService;
  let workspaceRepository: jest.Mocked<WorkspaceRepository>;

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

    service = new UpdateWorkspaceService(workspaceRepository);
  });

  afterEach(() => jest.clearAllMocks());

  it('should return left(WorkspaceNotFoundError) when workspace not found', async () => {
    workspaceRepository.findById.mockResolvedValue(null);

    const result = await service.execute(makeRequest());
    expect(result.isLeft()).toBe(true);
    expect(result.value).toBeInstanceOf(WorkspaceNotFoundError);
  });

  it('should update workspace and return it', async () => {
    const workspace = makeWorkspace();
    workspaceRepository.findById.mockResolvedValue(workspace);
    workspaceRepository.update.mockImplementation(async (w) => w);

    const result = await service.execute(makeRequest({ name: 'New Name' }));

    expect(result.isRight()).toBe(true);
    if (result.isRight()) expect(result.value.name).toBe('New Name');
    expect(workspaceRepository.update).toHaveBeenCalledTimes(1);
  });
});
