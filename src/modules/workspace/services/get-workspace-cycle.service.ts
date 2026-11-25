import { normalizeWorkspaceCycle, type WorkspaceCycle } from '@constants/enums';
import { Injectable } from '@nestjs/common';
import { WorkspaceRepository } from '../repositories/contracts/WorkspaceRepository';

@Injectable()
export class GetWorkspaceCycleService {
  constructor(private readonly workspaceRepository: WorkspaceRepository) {}

  async execute(workspaceId: string): Promise<WorkspaceCycle | null> {
    const workspace = await this.workspaceRepository.findById(workspaceId);

    if (workspace === null) return null;

    return normalizeWorkspaceCycle(workspace.cycle);
  }
}
