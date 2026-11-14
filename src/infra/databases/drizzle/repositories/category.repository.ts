import { TransactionType } from '@constants/enums';
import { DrizzleService } from '@infra/databases/drizzle/drizzle.service';
import { Category } from '@modules/category/entities/Category';
import {
  CategoryNameAlreadyExistsError,
  CategoryReferenceCounts,
  InvalidParentCategoryError,
} from '@modules/category/errors';
import {
  CategoryDeleteResult,
  CategoryListFilters,
  CategoryRepository,
} from '@modules/category/repositories/contracts/CategoryRepository';
import { Injectable } from '@nestjs/common';
import {
  and,
  asc,
  count,
  desc,
  eq,
  gte,
  inArray,
  isNull,
  or,
  sql,
} from 'drizzle-orm';
import { getErrorDetails } from '@shared/utils/error-details';
import { CategoryMapper } from '../mappers/category.mapper';
import * as schema from '../schema';

const FOREIGN_KEY_VIOLATION = '23503';
const UNIQUE_VIOLATION = '23505';
const CATEGORY_PARENT_FK = /categories_parent_id_(categories_id_fk|fkey)/;

type ReferenceCountClient = Pick<
  Parameters<Parameters<DrizzleService['db']['transaction']>[0]>[0],
  'select'
>;

@Injectable()
export class CategoryRepositoryImplementation implements CategoryRepository {
  constructor(private readonly drizzle: DrizzleService) {}

  async create(category: Category): Promise<Category> {
    return this.executeWriteChecked(async () => {
      const [createdCategory] = await this.drizzle.db
        .insert(schema.categories)
        .values(CategoryMapper.toDatabase(category))
        .returning();

      return CategoryMapper.toDomain(createdCategory);
    });
  }

  async update(category: Category): Promise<Category> {
    return this.executeWriteChecked(async () => {
      const [updatedCategory] = await this.drizzle.db
        .update(schema.categories)
        .set(CategoryMapper.toDatabase(category))
        .where(eq(schema.categories.id, category.id))
        .returning();

      return CategoryMapper.toDomain(updatedCategory);
    });
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

  async findVisibleById(
    id: string,
    workspaceId: string,
  ): Promise<Category | null> {
    const [category] = await this.drizzle.db
      .select()
      .from(schema.categories)
      .where(
        and(
          eq(schema.categories.id, id),
          or(
            eq(schema.categories.workspaceId, workspaceId),
            eq(schema.categories.isSystemCategory, true),
          ),
        ),
      )
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
    filters?: CategoryListFilters,
    page?: number,
    limit?: number,
  ): Promise<{
    categories: Category[];
    total: number;
    usageCounts: Record<string, number>;
  }> {
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
      filters?.visibility === 'visible'
        ? eq(schema.categories.isHidden, false)
        : undefined,
      parentIdCondition,
    );

    const query = this.drizzle.db
      .select({
        id: schema.categories.id,
        workspaceId: schema.categories.workspaceId,
        name: schema.categories.name,
        type: schema.categories.type,
        isSystemCategory: schema.categories.isSystemCategory,
        isHidden: schema.categories.isHidden,
        parentId: schema.categories.parentId,
        usageCount: sql<number>`count(${schema.transactions.id})`.mapWith(
          Number,
        ),
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
        schema.categories.isHidden,
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
      categories: rows.map((row) => CategoryMapper.toDomain(row)),
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
    return countChildren(this.drizzle.db, categoryId);
  }

  async countTransactions(categoryId: string): Promise<number> {
    return countTransactions(this.drizzle.db, categoryId);
  }

  async countBudgetAllocations(categoryId: string): Promise<number> {
    return countBudgetAllocations(this.drizzle.db, categoryId);
  }

  async countRecurringTransactions(categoryId: string): Promise<number> {
    return countRecurringTransactions(this.drizzle.db, categoryId);
  }

  async deleteIfUnreferenced(
    categoryId: string,
    workspaceId: string,
  ): Promise<CategoryDeleteResult> {
    try {
      return await this.drizzle.db.transaction(async (tx) => {
        const references = await countCategoryReferences(tx, categoryId);
        if (hasReferences(references)) return { deleted: false, references };

        await tx
          .delete(schema.categories)
          .where(
            and(
              eq(schema.categories.id, categoryId),
              eq(schema.categories.workspaceId, workspaceId),
            ),
          );

        return { deleted: true };
      });
    } catch (error) {
      if (getErrorDetails(error).sqlState !== FOREIGN_KEY_VIOLATION)
        throw error;

      return {
        deleted: false,
        references: await countCategoryReferences(this.drizzle.db, categoryId),
      };
    }
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

  private async executeWriteChecked<T>(write: () => Promise<T>): Promise<T> {
    try {
      return await write();
    } catch (error) {
      const details = getErrorDetails(error);

      if (details.sqlState === UNIQUE_VIOLATION) {
        throw new CategoryNameAlreadyExistsError();
      }

      if (
        details.sqlState === FOREIGN_KEY_VIOLATION &&
        CATEGORY_PARENT_FK.test(details.messageChain)
      ) {
        throw new InvalidParentCategoryError(
          'a categoria pai informada não existe.',
        );
      }

      throw error;
    }
  }
}

async function countTransactions(
  client: ReferenceCountClient,
  categoryId: string,
): Promise<number> {
  const [{ total }] = await client
    .select({ total: count() })
    .from(schema.transactions)
    .where(eq(schema.transactions.categoryId, categoryId));

  return total;
}

async function countBudgetAllocations(
  client: ReferenceCountClient,
  categoryId: string,
): Promise<number> {
  const [{ total }] = await client
    .select({ total: count() })
    .from(schema.budgetAllocations)
    .where(eq(schema.budgetAllocations.categoryId, categoryId));

  return total;
}

async function countRecurringTransactions(
  client: ReferenceCountClient,
  categoryId: string,
): Promise<number> {
  const [{ total }] = await client
    .select({ total: count() })
    .from(schema.recurringTransactions)
    .where(eq(schema.recurringTransactions.categoryId, categoryId));

  return total;
}

async function countChildren(
  client: ReferenceCountClient,
  categoryId: string,
): Promise<number> {
  const [{ total }] = await client
    .select({ total: count() })
    .from(schema.categories)
    .where(eq(schema.categories.parentId, categoryId));

  return total;
}

async function countCategoryReferences(
  client: ReferenceCountClient,
  categoryId: string,
): Promise<CategoryReferenceCounts> {
  const [transactions, allocations, recurringRules, children] =
    await Promise.all([
      countTransactions(client, categoryId),
      countBudgetAllocations(client, categoryId),
      countRecurringTransactions(client, categoryId),
      countChildren(client, categoryId),
    ]);

  return { transactions, allocations, recurringRules, children };
}

function hasReferences({
  transactions,
  allocations,
  recurringRules,
  children,
}: CategoryReferenceCounts): boolean {
  return transactions + allocations + recurringRules + children > 0;
}
