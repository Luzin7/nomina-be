import { UserNotFoundError } from '@modules/user/errors';
import { UserRepository } from '@modules/user/repositories/contracts/user.repository';
import {
  IssuedAuthSession,
  IssueAuthSessionService,
} from '@modules/user/services/issue-auth-session.service';
import {
  WorkspaceNotFoundError,
  WorkspaceUserNotFoundError,
} from '@modules/workspace/errors';
import { WorkspaceRepository } from '@modules/workspace/repositories/contracts/WorkspaceRepository';
import { WorkspaceUserRepository } from '@modules/workspace/repositories/contracts/WorkspaceUserRepository';
import { Injectable } from '@nestjs/common';
import { TokenPayloadSchema } from '@providers/auth/strategys/jwtStrategy';
import { Service } from '@shared/core/contracts/Service';
import { Either, left } from '@shared/core/errors/Either';
import { SwitchWorkspaceRequest } from './switch-workspace.dto';

type Request = SwitchWorkspaceRequest & Pick<TokenPayloadSchema, 'sub'>;
type Response = IssuedAuthSession;

@Injectable()
export class SwitchWorkspaceService implements Service<
  Request,
  Error,
  Response
> {
  constructor(
    private readonly workspaceRepository: WorkspaceRepository,
    private readonly workspaceUserRepository: WorkspaceUserRepository,
    private readonly userRepository: UserRepository,
    private readonly issueAuthSessionService: IssueAuthSessionService,
  ) {}

  async execute({
    workspaceId,
    sub,
  }: Request): Promise<Either<Error, Response>> {
    const workspace = await this.workspaceRepository.findById(workspaceId);
    if (!workspace) return left(new WorkspaceNotFoundError());

    const workspaceUser =
      await this.workspaceUserRepository.findUserByWorkspaceAndUserId(
        workspaceId,
        sub,
      );
    if (!workspaceUser) return left(new WorkspaceUserNotFoundError());

    const user = await this.userRepository.findUniqueById(sub);
    if (!user) return left(new UserNotFoundError());

    return this.issueAuthSessionService.execute({
      userId: user.id,
      userName: user.name,
      workspaceId: workspace.id,
      workspaceName: workspace.name,
      role: workspaceUser.role,
    });
  }
}
