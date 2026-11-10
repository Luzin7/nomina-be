import { TransactionType } from '@constants/enums';
import { CacheProvider } from '@infra/cache/contracts/CacheProvider';
import { Category } from '@modules/category/entities/Category';
import {
  CategoryNameAlreadyExistsError,
  InvalidParentCategoryError,
} from '@modules/category/errors';
import { CategoryRepository } from '@modules/category/repositories/contracts/CategoryRepository';
import { bumpCategoryGeneration } from '@modules/category/services/category-list-cache';
import { Injectable } from '@nestjs/common';
import { TokenPayloadSchema } from '@providers/auth/strategys/jwtStrategy';
import { Service } from '@shared/core/contracts/Service';
import { Either, left, right } from '@shared/core/errors/Either';
import { CreateCategoryRequest } from './create-category.dto';

type Request = CreateCategoryRequest & Pick<TokenPayloadSchema, 'workspaceId'>;

@Injectable()
export class CreateCategoryService implements Service<
  Request,
  Error,
  Category
> {
  constructor(
    private readonly categoryRepository: CategoryRepository,
    private readonly cacheProvider: CacheProvider,
  ) {}

  async execute({
    name,
    type,
    parentId,
    workspaceId,
  }: Request): Promise<Either<Error, Category>> {
    const parentError = await this.validateParent(
      parentId ?? null,
      type,
      workspaceId,
    );
    if (parentError) return left(parentError);

    const category = Category.create({
      workspaceId,
      name,
      type,
      parentId: parentId ?? null,
      isSystemCategory: false,
    });
    if (category.isLeft()) return left(category.value);

    try {
      const created = await this.categoryRepository.create(category.value);
      await bumpCategoryGeneration({
        cache: this.cacheProvider,
        workspaceId,
        operation: 'create-category',
      });

      return right(created);
    } catch (error) {
      if (error instanceof CategoryNameAlreadyExistsError) return left(error);
      throw error;
    }
  }

  private async validateParent(
    parentId: string | null,
    type: TransactionType,
    workspaceId: string,
  ): Promise<Error | null> {
    if (!parentId) return null;

    const parent = await this.categoryRepository.findById(parentId);
    if (!parent) {
      return new InvalidParentCategoryError(
        'a categoria pai informada não existe.',
      );
    }

    return this.parentConstraint(parent, type, workspaceId);
  }

  private parentConstraint(
    parent: Category,
    type: TransactionType,
    workspaceId: string,
  ): Error | null {
    if (parent.workspaceId !== null && parent.workspaceId !== workspaceId) {
      return new InvalidParentCategoryError(
        'a categoria pai não está disponível para este workspace.',
      );
    }

    if (parent.parentId !== null) {
      return new InvalidParentCategoryError(
        'a categoria pai precisa ser uma categoria raiz.',
      );
    }

    if (parent.type !== type) {
      return new InvalidParentCategoryError(
        'a categoria pai precisa ter o mesmo tipo da categoria criada.',
      );
    }

    return null;
  }
}
