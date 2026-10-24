import { UserRole } from '@constants/enums';
import { Workspace } from '@modules/workspace/entities/Workspace';
import { WorkspaceRepository } from '@modules/workspace/repositories/contracts/WorkspaceRepository';
import { Injectable } from '@nestjs/common';
import { TokenPayloadSchema } from '@providers/auth/strategys/jwtStrategy';
import { Service } from '@shared/core/contracts/Service';
import { Either, right } from '@shared/core/errors/Either';
import { ListWorkspacesRequest } from './list-workspaces.dto';

type Request = ListWorkspacesRequest & Pick<TokenPayloadSchema, 'sub'>;

type Response = {
  workspaces: Array<{
    workspace: Workspace;
    role: UserRole;
    isDefault: boolean;
  }>;
  total: number;
};

@Injectable()
export class ListWorkspacesService implements Service<
  Request,
  never,
  Response
> {
  constructor(private readonly workspaceRepository: WorkspaceRepository) {}

  async execute({
    page,
    pageSize,
    sub,
  }: Request): Promise<Either<never, Response>> {
    const result = await this.workspaceRepository.findByMemberUserId(
      sub,
      page,
      pageSize,
    );

    return right({
      workspaces: result.workspaces,
      total: result.total,
    });
  }
}
