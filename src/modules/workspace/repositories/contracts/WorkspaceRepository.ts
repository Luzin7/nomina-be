import { UserRole } from '@constants/enums';
import { Workspace } from '@modules/workspace/entities/Workspace';
import { WorkspaceUser } from '@modules/workspace/entities/WorkspaceUser';

export abstract class WorkspaceRepository {
  abstract create(workspace: Workspace): Promise<Workspace>;
  abstract createWithOwnerAndAccount(
    workspace: Workspace,
    owner: WorkspaceUser,
  ): Promise<void>;

  abstract update(workspace: Workspace): Promise<Workspace>;
  abstract delete(id: string): Promise<void>;
  abstract findById(id: string): Promise<Workspace | null>;
  abstract findTimezoneById(id: string): Promise<string | null>;

  abstract findOwnedByUserId(
    userId: string,
    page: number,
    limit: number,
  ): Promise<{
    workspaces: Array<{
      workspace: Workspace;
      role: UserRole;
      isDefault: boolean;
    }>;
    total: number;
  }>;

  abstract countOwnedByUserId(userId: string): Promise<number>;
}
