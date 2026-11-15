import { TransactionType } from '@constants/enums';
import { Category } from '@modules/category/entities/Category';
import { CategoryReferenceCounts } from '@modules/category/errors';

export type CategoryDeleteResult =
  | { deleted: true }
  | { deleted: false; references: CategoryReferenceCounts };

export type CategoryVisibility = 'visible' | 'all';

export type CategoryListFilters = {
  type?: TransactionType;
  parentId?: string | null;
  visibility?: CategoryVisibility;
};

export abstract class CategoryRepository {
  abstract create(category: Category): Promise<Category>;

  abstract update(category: Category): Promise<Category>;

  abstract delete(id: string): Promise<void>;

  abstract findById(id: string): Promise<Category | null>;

  abstract findVisibleById(
    id: string,
    workspaceId: string,
  ): Promise<Category | null>;

  abstract countByWorkspaceId(workspaceId: string): Promise<number>;
  abstract findUniqueByAttributes(
    name: string,
    type: TransactionType,
    workspaceId: string,
    parentId?: string | null,
  ): Promise<Category | null>;

  abstract findManyByWorkspaceId(
    workspaceId: string,
    filters?: CategoryListFilters,
    page?: number,
    limit?: number,
  ): Promise<{
    categories: Category[];
    total: number;
    usageCounts: Record<string, number>;
  }>;

  abstract countChildren(categoryId: string): Promise<number>;

  abstract countTransactions(categoryId: string): Promise<number>;

  abstract countBudgetAllocations(categoryId: string): Promise<number>;

  abstract countRecurringTransactions(categoryId: string): Promise<number>;

  abstract deleteIfUnreferenced(
    categoryId: string,
    workspaceId: string,
  ): Promise<CategoryDeleteResult>;

  abstract reassignChildren(
    categoryId: string,
    newParentId: string | null,
  ): Promise<void>;

  abstract findManyByIds(categoryIds: string[]): Promise<Category[]>;
}
