import { CacheProvider } from '@infra/cache/contracts/CacheProvider';
import { buildCategoryListInvalidationPattern } from '@modules/category/constants/cache-keys';
import {
  CategoryInUseError,
  CategoryTargetNotFoundError,
  SystemCategoryModificationError,
} from '@modules/category/errors';
import { CategoryRepository } from '@modules/category/repositories/contracts/CategoryRepository';
import { Injectable } from '@nestjs/common';
import { TokenPayloadSchema } from '@providers/auth/strategys/jwtStrategy';
import { Service } from '@shared/core/contracts/Service';
import { Either, left, right } from '@shared/core/errors/Either';
import { DeleteCategoryRequest } from './delete-category.dto';

type Request = DeleteCategoryRequest & Pick<TokenPayloadSchema, 'workspaceId'>;

@Injectable()
export class DeleteCategoryService implements Service<Request, Error, void> {
  constructor(
    private readonly categoryRepository: CategoryRepository,
    private readonly cacheProvider: CacheProvider,
  ) {}

  async execute({ id, workspaceId }: Request): Promise<Either<Error, void>> {
    const category = await this.categoryRepository.findById(id);
    if (!category) return left(new CategoryTargetNotFoundError());

    if (category.isSystemCategory) {
      return left(new SystemCategoryModificationError());
    }

    if (category.workspaceId !== workspaceId) {
      return left(new CategoryTargetNotFoundError());
    }

    const result = await this.categoryRepository.deleteIfUnreferenced(id);
    if (!result.deleted) return left(new CategoryInUseError(result.references));

    await this.cacheProvider.delByPattern(
      buildCategoryListInvalidationPattern(workspaceId),
    );

    return right(undefined);
  }
}
