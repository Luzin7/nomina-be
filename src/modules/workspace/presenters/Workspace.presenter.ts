import { Workspace } from '../entities/Workspace';

export class WorkspacePresenter {
  static toHTTP(workspace: Workspace) {
    return {
      id: workspace.id,
      name: workspace.name,
      currency: workspace.currency,
      timezone: workspace.timezone,
      createdAt: workspace.createdAt,
    };
  }
}
