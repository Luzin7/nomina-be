import { WorkspaceRepository } from '@modules/workspace/repositories/contracts/WorkspaceRepository';
import { ListWorkspacesService } from './list-workspaces.service';

type ServiceRequest = Parameters<
  typeof ListWorkspacesService.prototype.execute
>[0];

function makeRequest(
  overrides: Partial<Record<string, unknown>> = {},
): ServiceRequest {
  return {
    sub: 'user-1',
    page: 1,
    pageSize: 20,
    ...overrides,
  } as ServiceRequest;
}

describe('ListWorkspacesService', () => {
  let service: ListWorkspacesService;
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

    service = new ListWorkspacesService(workspaceRepository);
  });

  afterEach(() => jest.clearAllMocks());

  it('should return workspaces and total from repository', async () => {
    workspaceRepository.findOwnedByUserId.mockResolvedValue({
      workspaces: [],
      total: 0,
    });

    const result = await service.execute(makeRequest());

    expect(result.isRight()).toBe(true);
    if (result.isRight()) {
      expect(result.value.workspaces).toEqual([]);
      expect(result.value.total).toBe(0);
    }
    expect(workspaceRepository.findOwnedByUserId).toHaveBeenCalledWith(
      'user-1',
      1,
      20,
    );
  });

  it('should pass pagination params to repository', async () => {
    workspaceRepository.findOwnedByUserId.mockResolvedValue({
      workspaces: [],
      total: 5,
    });

    await service.execute(makeRequest({ page: 2, pageSize: 10 }));

    expect(workspaceRepository.findOwnedByUserId).toHaveBeenCalledWith(
      'user-1',
      2,
      10,
    );
  });
});
