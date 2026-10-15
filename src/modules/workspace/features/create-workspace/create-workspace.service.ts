import { UserRole } from '@constants/enums';
import { buildDefaultCategories } from '@modules/category/constants/default-categories';
import { Workspace } from '@modules/workspace/entities/Workspace';
import { WorkspaceUser } from '@modules/workspace/entities/WorkspaceUser';
import { WorkspaceRepository } from '@modules/workspace/repositories/contracts/WorkspaceRepository';
import { Injectable } from '@nestjs/common';
import { TokenPayloadSchema } from '@providers/auth/strategys/jwtStrategy';
import { Service } from '@shared/core/contracts/Service';
import { Either, left, right } from '@shared/core/errors/Either';
import { CreateWorkspaceRequest } from './create-workspace.dto';

type Request = CreateWorkspaceRequest & Pick<TokenPayloadSchema, 'sub'>;

type Response = {
  workspace: Workspace;
  workspaceUser: WorkspaceUser;
};

@Injectable()
export class CreateWorkspaceService implements Service<
  Request,
  Error,
  Response
> {
  constructor(private readonly workspaceRepository: WorkspaceRepository) {}

  async execute({
    currency = 'BRL',
    name,
    isDefault,
    sub,
  }: Request): Promise<Either<Error, Response>> {
    const workspaceOrError = Workspace.create(
      {
        name,
        currency,
      },
      crypto.randomUUID(),
    );
    if (workspaceOrError.isLeft()) {
      return left(workspaceOrError.value);
    }

    const workspace = workspaceOrError.value;

    const workspaceUserOrError = WorkspaceUser.create(
      {
        userId: sub,
        workspaceId: workspace.id,
        role: UserRole.OWNER,
        isDefault: !!isDefault,
      },
      crypto.randomUUID(),
    );
    if (workspaceUserOrError.isLeft()) {
      return left(workspaceUserOrError.value);
    }

    const workspaceUser = workspaceUserOrError.value;

    await this.workspaceRepository.createWithOwnerAndAccount(
      workspace,
      workspaceUser,
      buildDefaultCategories(workspace.id),
    );

    return right({
      workspace,
      workspaceUser,
    });
  }
}
