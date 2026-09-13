import { TransactionType } from '@constants/enums';
import { DrizzleService } from '@infra/databases/drizzle/drizzle.service';
import { Category } from '@modules/category/entities/Category';
import { CategoryRepository } from '@modules/category/repositories/contracts/CategoryRepository';
import { Injectable } from '@nestjs/common';
import { and, asc, count, desc, eq, gte, inArray, isNull, or, sql } from 'drizzle-orm';
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
  ): Promise<{ categories: Category[]; total: number; usageCounts: Record<string, number> }> {
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

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
      .select({
        id: schema.categories.id,
        workspaceId: schema.categories.workspaceId,
        name: schema.categories.name,
        type: schema.categories.type,
        isSystemCategory: schema.categories.isSystemCategory,
        parentId: schema.categories.parentId,
        usageCount: sql<number>`count(${schema.transactions.id})`.mapWith(Number),
      })
      .from(schema.categories)
      .leftJoin(
        schema.transactions,
        and(
          eq(schema.transactions.categoryId, schema.categories.id),
          gte(schema.transactions.date, sixMonthsAgo),
        ),
      )
      .where(conditions)
      .groupBy(
        schema.categories.id,
        schema.categories.workspaceId,
        schema.categories.name,
        schema.categories.type,
        schema.categories.isSystemCategory,
        schema.categories.parentId,
      )
      .orderBy(
        desc(sql`count(${schema.transactions.id})`),
        asc(schema.categories.name),
      );

    if (page !== undefined && limit !== undefined) {
      query.limit(limit).offset((page - 1) * limit);
    }

    const [rows, [{ totalCount }]] = await Promise.all([
      query,
      this.drizzle.db
        .select({ totalCount: count() })
        .from(schema.categories)
        .where(conditions),
    ]);

    const usageCounts: Record<string, number> = {};
    for (const row of rows) {
      usageCounts[row.id] = row.usageCount;
    }

    return {
      categories: rows.map((row) =>
        CategoryMapper.toDomain(row as unknown as typeof schema.categories.$inferSelect),
      ),
      total: totalCount,
      usageCounts,
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
    if (!categoryIds.length) return [];

    const categories = await this.drizzle.db
      .select()
      .from(schema.categories)
      .where(inArray(schema.categories.id, categoryIds));

    return categories.map(CategoryMapper.toDomain);
  }
}
