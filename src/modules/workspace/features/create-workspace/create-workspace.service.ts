import { UserRole } from '@constants/enums';
import { Category } from '@modules/category/entities/Category';
import { CategoryRepository } from '@modules/category/repositories/contracts/CategoryRepository';
import {
  SEED_CHILD_CATEGORIES,
  SEED_PARENT_CATEGORIES,
} from '@modules/category/constants/seed-categories';
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
  constructor(
    private readonly workspaceRepository: WorkspaceRepository,
    private readonly categoryRepository: CategoryRepository,
  ) {}

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
    );

    await this.seedWorkspaceCategories(workspace.id);

    return right({
      workspace,
      workspaceUser,
    });
  }

  private async seedWorkspaceCategories(workspaceId: string): Promise<void> {
    const systemIdToWorkspaceId = new Map<string, string>();

    for (const seedCat of SEED_PARENT_CATEGORIES) {
      const categoryOrError = Category.create(
        {
          workspaceId,
          name: seedCat.name,
          type: seedCat.type,
          parentId: null,
          isSystemCategory: false,
        },
        crypto.randomUUID(),
      );

      if (categoryOrError.isLeft()) {
        continue;
      }

      const created = await this.categoryRepository.create(
        categoryOrError.value,
      );
      systemIdToWorkspaceId.set(seedCat.id, created.id);
    }

    for (const seedCat of SEED_CHILD_CATEGORIES) {
      const workspaceParentId = systemIdToWorkspaceId.get(seedCat.parentId);
      if (!workspaceParentId) {
        continue;
      }

      const categoryOrError = Category.create(
        {
          workspaceId,
          name: seedCat.name,
          type: seedCat.type,
          parentId: workspaceParentId,
          isSystemCategory: false,
        },
        crypto.randomUUID(),
      );

      if (categoryOrError.isLeft()) {
        continue;
      }

      await this.categoryRepository.create(categoryOrError.value);
    }
  }
}
