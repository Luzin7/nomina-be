import { CacheProvider } from '@infra/cache/contracts/CacheProvider';
import { Category } from '@modules/category/entities/Category';
import {
  CategoryNameAlreadyExistsError,
  CategoryTargetNotFoundError,
  EmptyCategoryUpdateError,
  SystemCategoryModificationError,
} from '@modules/category/errors';
import { CategoryRepository } from '@modules/category/repositories/contracts/CategoryRepository';
import { bumpCategoryGeneration } from '@modules/category/services/category-list-cache';
import { Injectable } from '@nestjs/common';
import { TokenPayloadSchema } from '@providers/auth/strategys/jwtStrategy';
import { bumpReportGeneration } from '@shared/cache/report-cache';
import { Service } from '@shared/core/contracts/Service';
import { Either, left, right } from '@shared/core/errors/Either';
import { UpdateCategoryRequest } from './update-category.dto';

type Request = UpdateCategoryRequest &
  Pick<TokenPayloadSchema, 'workspaceId'> & { id: string };

@Injectable()
export class UpdateCategoryService implements Service<
  Request,
  Error,
  Category
> {
  constructor(
    private readonly categoryRepository: CategoryRepository,
    private readonly cacheProvider: CacheProvider,
  ) {}

  async execute({
    id,
    name,
    isHidden,
    workspaceId,
  }: Request): Promise<Either<Error, Category>> {
    if (name === undefined && isHidden === undefined) {
      return left(new EmptyCategoryUpdateError());
    }

    const category = await this.categoryRepository.findById(id);
    if (!category) return left(new CategoryTargetNotFoundError());

    if (category.isSystemCategory) {
      return left(new SystemCategoryModificationError());
    }

    if (category.workspaceId !== workspaceId) {
      return left(new CategoryTargetNotFoundError());
    }

    const changeError = this.applyChanges(category, name, isHidden);
    if (changeError) return left(changeError);

    try {
      const updated = await this.categoryRepository.update(category);
      await bumpCategoryGeneration({
        cache: this.cacheProvider,
        workspaceId,
        operation: 'update-category',
      });

      if (isHidden !== undefined) {
        await bumpReportGeneration(this.cacheProvider, workspaceId);
      }

      return right(updated);
    } catch (error) {
      if (error instanceof CategoryNameAlreadyExistsError) return left(error);
      throw error;
    }
  }

  private applyChanges(
    category: Category,
    name: string | undefined,
    isHidden: boolean | undefined,
  ): Error | null {
    if (name !== undefined) {
      const renamed = category.updateName(name);
      if (renamed.isLeft()) return renamed.value;
    }

    if (isHidden !== undefined) {
      const hidden = category.hide(isHidden);
      if (hidden.isLeft()) return hidden.value;
    }

    return null;
  }
}
