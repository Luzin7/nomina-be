import { TransactionType } from '@constants/enums';
import { DrizzleService } from '@infra/databases/drizzle/drizzle.service';
import { Category } from '@modules/category/entities/Category';
import { CategoryRepository } from '@modules/category/repositories/contracts/CategoryRepository';
import { Injectable } from '@nestjs/common';
import { and, count, eq, inArray, isNull, or } from 'drizzle-orm';
import { CategoryMapper } from '../mappers/category.mapper';
import * as schema from '../schema';

@Injectable()
export class CategoryRepositoryImplementation implements CategoryRepository {
  constructor(private readonly drizzle: DrizzleService) {}

  async create(category: Category): Promise<Category> {
    const [createdCategory] = await this.drizzle.db
      .insert(schema.categories)
      .values(CategoryMapper.toDatabase(category))
      .returning();

    return CategoryMapper.toDomain(createdCategory);
  }

  async update(category: Category): Promise<Category> {
    const [updatedCategory] = await this.drizzle.db
      .update(schema.categories)
      .set(CategoryMapper.toDatabase(category))
      .where(eq(schema.categories.id, category.id))
      .returning();

    return CategoryMapper.toDomain(updatedCategory);
  }

  async delete(id: string): Promise<void> {
    await this.drizzle.db
      .delete(schema.categories)
      .where(eq(schema.categories.id, id));
  }

  async findById(id: string): Promise<Category | null> {
    const [category] = await this.drizzle.db
      .select()
      .from(schema.categories)
      .where(eq(schema.categories.id, id))
      .limit(1);

    if (!category) return null;
    return CategoryMapper.toDomain(category);
  }

  async findUniqueByAttributes(
    name: string,
    type: TransactionType,
    workspaceId: string,
    parentId?: string | null,
  ): Promise<Category | null> {
    const [category] = await this.drizzle.db
      .select()
      .from(schema.categories)
      .where(
        and(
          eq(schema.categories.workspaceId, workspaceId),
          eq(schema.categories.name, name),
          eq(schema.categories.type, type),
          // Proteção estrita do SQL contra comparações falhas de NULL
          parentId
            ? eq(schema.categories.parentId, parentId)
            : isNull(schema.categories.parentId),
        ),
      )
      .limit(1);

    if (!category) return null;
    return CategoryMapper.toDomain(category);
  }

  async findManyByWorkspaceId(
    workspaceId: string,
    filters?: { type?: TransactionType; parentId?: string | null },
    page?: number,
    limit?: number,
  ): Promise<{ categories: Category[]; total: number }> {
    const parentIdCondition =
      filters?.parentId === undefined
        ? undefined
        : filters.parentId === null
          ? isNull(schema.categories.parentId)
          : eq(schema.categories.parentId, filters.parentId);

    const conditions = and(
      or(
        eq(schema.categories.workspaceId, workspaceId),
        eq(schema.categories.isSystemCategory, true),
      ),
      filters?.type ? eq(schema.categories.type, filters.type) : undefined,
      parentIdCondition,
    );

    const query = this.drizzle.db
      .select()
      .from(schema.categories)
      .where(conditions);

    if (page !== undefined && limit !== undefined) {
      query.limit(limit).offset((page - 1) * limit);
    }

    const [categories, [{ totalCount }]] = await Promise.all([
      query,
      this.drizzle.db
        .select({ totalCount: count() })
        .from(schema.categories)
        .where(conditions),
    ]);

    return {
      categories: categories.map(CategoryMapper.toDomain),
      total: totalCount,
    };
  }

  async countByWorkspaceId(workspaceId: string): Promise<number> {
    const [{ totalCount }] = await this.drizzle.db
      .select({ totalCount: count() })
      .from(schema.categories)
      .where(
        and(
          eq(schema.categories.workspaceId, workspaceId),
          or(
            eq(schema.categories.isSystemCategory, false),
            isNull(schema.categories.isSystemCategory),
          ),
        ),
      );

    return totalCount;
  }

  async countChildren(categoryId: string): Promise<number> {
    const [{ childCount }] = await this.drizzle.db
      .select({ childCount: count() })
      .from(schema.categories)
      .where(eq(schema.categories.parentId, categoryId));

    return childCount;
  }

  async countTransactions(categoryId: string): Promise<number> {
    const [{ txCount }] = await this.drizzle.db
      .select({ txCount: count() })
      .from(schema.transactions)
      .where(eq(schema.transactions.categoryId, categoryId));

    return txCount;
  }

  async reassignChildren(
    categoryId: string,
    newParentId: string | null,
  ): Promise<void> {
    await this.drizzle.db
      .update(schema.categories)
      .set({ parentId: newParentId })
      .where(eq(schema.categories.parentId, categoryId));
  }

  async findManyByIds(categoryIds: string[]): Promise<Category[]> {
    if (!categoryIds.length) return []; // Retorno rápido para não quebrar a query 'inArray' com array vazio

    const categories = await this.drizzle.db
      .select()
      .from(schema.categories)
      .where(inArray(schema.categories.id, categoryIds));

    return categories.map(CategoryMapper.toDomain);
  }
}
