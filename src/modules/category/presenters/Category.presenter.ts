import { Category } from '../entities/Category';

interface CategoryHTTP {
  id: string;
  workspaceId: string | null;
  name: string;
  type: string;
  parentId: string | null;
  isSubcategory: boolean;
  isSystemCategory: boolean;
}

interface CategoryHierarchyHTTP extends CategoryHTTP {
  children: CategoryHTTP[];
}

export class CategoryPresenter {
  static toHTTP(category: Category): CategoryHTTP {
    return {
      id: category.id,
      workspaceId: category.workspaceId,
      name: category.name,
      type: category.type,
      parentId: category.parentId,
      isSubcategory: category.isSubcategory,
      isSystemCategory: category.isSystemCategory,
    };
  }

  static toHTTPHierarchy(
    parent: Category,
    children: Category[],
  ): CategoryHierarchyHTTP {
    return {
      ...CategoryPresenter.toHTTP(parent),
      children: children.map(CategoryPresenter.toHTTP),
    };
  }
}
