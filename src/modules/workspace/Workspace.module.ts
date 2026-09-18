import { DatabaseModule } from '@infra/databases/Database.module';
import { Module } from '@nestjs/common';
import { CryptographyModule } from '@providers/cryptography/Cryptography.module';
import { DateModule } from '@providers/date/Date.module';
import { SubscriptionModule } from '../subscription/Subscription.module';
import { UserModule } from '../user/User.module';
import { AcceptWorkspaceInviteController } from './features/accept-workspace-invite/accept-workspace-invite.controller';
import { AcceptWorkspaceInviteService } from './features/accept-workspace-invite/accept-workspace-invite.service';
import { AddUserToWorkspaceController } from './features/add-user-to-workspace/add-user-to-workspace.controller';
import { AddUserToWorkspaceService } from './features/add-user-to-workspace/add-user-to-workspace.service';
import { CreateWorkspaceInviteController } from './features/create-workspace-invite/create-workspace-invite.controller';
import { CreateWorkspaceInviteService } from './features/create-workspace-invite/create-workspace-invite.service';
import { CreateWorkspaceController } from './features/create-workspace/create-workspace.controller';
import { CreateWorkspaceService } from './features/create-workspace/create-workspace.service';
import { DeleteWorkspaceController } from './features/delete-workspace/delete-workspace.controller';
import { DeleteWorkspaceService } from './features/delete-workspace/delete-workspace.service';
import { FindWorkspaceController } from './features/find-workspace/find-workspace.controller';
import { FindWorkspaceByIdService } from './features/find-workspace/find-workspace.service';
import { ListUsersFromWorkspaceController } from './features/list-user-from-workspace/list-user-from-workspace.controller';
import { ListUsersFromWorkspaceService } from './features/list-user-from-workspace/list-user-from-workspace.service';
import { ListWorkspacesController } from './features/list-workspaces/list-workspaces.controller';
import { ListWorkspacesService } from './features/list-workspaces/list-workspaces.service';
import { RemoveUserFromWorkspaceController } from './features/remove-user-from-workspace/remove-user-from-workspace.controller';
import { RemoveUserFromWorkspaceService } from './features/remove-user-from-workspace/remove-user-from-workspace.service';
import { SetDefaultWorkspaceController } from './features/set-default-workspace/set-default-workspace.controller';
import { SetDefaultWorkspaceService } from './features/set-default-workspace/set-default-workspace.service';
import { SwitchWorkspaceController } from './features/switch-workspace/switch-workspace.controller';
import { SwitchWorkspaceService } from './features/switch-workspace/switch-workspace.service';
import { UpdateWorkspaceUserController } from './features/update-workspace-user/update-workspace-user.controller';
import { UpdateWorkspaceUserService } from './features/update-workspace-user/update-workspace-user.service';
import { UpdateWorkspaceController } from './features/update-workspace/update-workspace.controller';
import { UpdateWorkspaceService } from './features/update-workspace/update-workspace.service';
import { GetWorkspaceTimezoneService } from './services/get-workspace-timezone.service';

@Module({
  imports: [
    DatabaseModule,
    UserModule,
    SubscriptionModule,
    CryptographyModule,
    DateModule,
  ],
  controllers: [
    CreateWorkspaceController,
    UpdateWorkspaceController,
    DeleteWorkspaceController,
    FindWorkspaceController,
    ListWorkspacesController,
    AddUserToWorkspaceController,
    RemoveUserFromWorkspaceController,
    UpdateWorkspaceUserController,
    ListUsersFromWorkspaceController,
    SwitchWorkspaceController,
    CreateWorkspaceInviteController,
    AcceptWorkspaceInviteController,
    SetDefaultWorkspaceController,
  ],
  providers: [
    CreateWorkspaceService,
    UpdateWorkspaceService,
    DeleteWorkspaceService,
    FindWorkspaceByIdService,
    ListWorkspacesService,
    AddUserToWorkspaceService,
    RemoveUserFromWorkspaceService,
    UpdateWorkspaceUserService,
    ListUsersFromWorkspaceService,
    SwitchWorkspaceService,
    CreateWorkspaceInviteService,
    AcceptWorkspaceInviteService,
    SetDefaultWorkspaceService,
    GetWorkspaceTimezoneService,
  ],
  exports: [
    FindWorkspaceByIdService,
    ListWorkspacesService,
    GetWorkspaceTimezoneService,
  ],
})
export class WorkspaceModule {}
