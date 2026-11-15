import { TransactionType } from '@constants/enums';
import * as schema from '@infra/databases/drizzle/schema';
import { Category } from '@modules/category/entities/Category';

type CategoryDrizzle = typeof schema.categories.$inferSelect;
type CategoryDrizzleInsert = typeof schema.categories.$inferInsert;

export class CategoryMapper {
  static toDomain(raw: CategoryDrizzle): Category {
    const result = Category.create(
      {
        isSystemCategory: raw.isSystemCategory,
        isHidden: raw.isHidden,
        name: raw.name,
        type: raw.type as TransactionType,
        workspaceId: raw.workspaceId,
        parentId: raw.parentId,
      },
      raw.id,
    );

    if (result.isLeft()) {
      throw result.value;
    }

    return result.value;
  }

  static toDatabase(entity: Category): CategoryDrizzleInsert {
    return {
      id: entity.id,
      isSystemCategory: entity.isSystemCategory,
      isHidden: entity.isHidden,
      name: entity.name,
      type: entity.type,
      workspaceId: entity.workspaceId,
      parentId: entity.parentId,
    };
  }
}
