import { type WorkspaceCycle } from '@constants/enums';
import { Workspace } from '../entities/Workspace';
import { WorkspaceRepository } from '../repositories/contracts/WorkspaceRepository';
import { GetWorkspaceCycleService } from './get-workspace-cycle.service';

const workspaceOf = (cycle: WorkspaceCycle): Workspace => {
  const workspace = Workspace.create({ name: 'Home', cycle });
  if (workspace.isLeft()) throw workspace.value;

  return workspace.value;
};

describe('GetWorkspaceCycleService', () => {
  let service: GetWorkspaceCycleService;
  let workspaceRepository: jest.Mocked<WorkspaceRepository>;

  beforeEach(() => {
    workspaceRepository = {
      findById: jest.fn(),
    } as unknown as jest.Mocked<WorkspaceRepository>;
    service = new GetWorkspaceCycleService(workspaceRepository);
  });

  it('returns the stored workspace cycle', async () => {
    workspaceRepository.findById.mockResolvedValue(workspaceOf('weekly'));

    const cycle = await service.execute('ws-1');

    expect(cycle).toBe('weekly');
    expect(workspaceRepository.findById).toHaveBeenCalledWith('ws-1');
  });

  it('returns null when the workspace is missing', async () => {
    workspaceRepository.findById.mockResolvedValue(null);

    await expect(service.execute('ws-1')).resolves.toBeNull();
  });
});
