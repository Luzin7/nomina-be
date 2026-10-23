import { WorkspaceInvite } from '@modules/workspace/entities/WorkspaceInvite';
import { WorkspaceUser } from '@modules/workspace/entities/WorkspaceUser';

export type AcceptInviteOutcome =
  | 'accepted'
  | 'already_used'
  | 'already_member';

export abstract class WorkspaceInviteRepository {
  abstract create(invite: WorkspaceInvite): Promise<WorkspaceInvite>;
  abstract findByCode(code: string): Promise<WorkspaceInvite | null>;
  abstract accept(
    invite: WorkspaceInvite,
    workspaceUser: WorkspaceUser,
  ): Promise<AcceptInviteOutcome>;
}
