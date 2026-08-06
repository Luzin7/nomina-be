import { TransactionType } from '@constants/enums';
import { Category } from '@modules/category/entities/Category';

export abstract class CategoryRepository {
  abstract create(category: Category): Promise<Category>;

  abstract update(category: Category): Promise<Category>;

  abstract delete(id: string): Promise<void>;

  abstract findById(id: string): Promise<Category | null>;

  /**
   * Busca uma categoria global (`workspaceId = null`, `isSystemCategory = true`)
   * pelo nome. Usado para resolver as categorias que o backend atribui sozinho,
   * como transferência e pagamento de fatura.
   */
  abstract findSystemCategoryByName(
    name: string,
    type: TransactionType,
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
    filters?: {
      type?: TransactionType;
      parentId?: string | null;
    },
    page?: number,
    limit?: number,
  ): Promise<{ categories: Category[]; total: number }>;

  abstract countChildren(categoryId: string): Promise<number>;

  abstract countTransactions(categoryId: string): Promise<number>;

  abstract reassignChildren(
    categoryId: string,
    newParentId: string | null,
  ): Promise<void>;

  abstract findManyByIds(categoryIds: string[]): Promise<Category[]>;
}
