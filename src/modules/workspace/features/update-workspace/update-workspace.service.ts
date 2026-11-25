import { Workspace } from '@modules/workspace/entities/Workspace';
import { WorkspaceNotFoundError } from '@modules/workspace/errors';
import { WorkspaceRepository } from '@modules/workspace/repositories/contracts/WorkspaceRepository';
import { Injectable } from '@nestjs/common';
import { TokenPayloadSchema } from '@providers/auth/strategys/jwtStrategy';
import { Service } from '@shared/core/contracts/Service';
import { Either, left, right } from '@shared/core/errors/Either';
import { UpdateWorkspaceRequest } from './update-workspace.dto';

type Request = UpdateWorkspaceRequest & Pick<TokenPayloadSchema, 'workspaceId'>;

type Response = Workspace;

@Injectable()
export class UpdateWorkspaceService implements Service<
  Request,
  Error,
  Response
> {
  constructor(private readonly workspaceRepository: WorkspaceRepository) {}

  async execute({
    name,
    workspaceId,
    currency = 'BRL',
    cycle,
  }: Request): Promise<Either<Error, Response>> {
    const workspace = await this.workspaceRepository.findById(workspaceId);

    if (!workspace) {
      return left(new WorkspaceNotFoundError());
    }

    workspace.updateDetails(
      name,
      currency,
      workspace.timezone,
      cycle ?? workspace.cycle,
    );

    await this.workspaceRepository.update(workspace);

    return right(workspace);
  }
}
