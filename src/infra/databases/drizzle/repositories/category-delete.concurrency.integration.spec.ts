import {
  AccountType,
  RecurrenceFrequency,
  TransactionStatus,
  TransactionType,
} from '@constants/enums';
import { DRIZZLE_TOKEN } from '@infra/databases/drizzle/drizzle.provider';
import { DrizzleService } from '@infra/databases/drizzle/drizzle.service';
import * as schema from '@infra/databases/drizzle/schema';
import { Category } from '@modules/category/entities/Category';
import { CategoryNameAlreadyExistsError } from '@modules/category/errors';
import { Test, TestingModule } from '@nestjs/testing';
import {
  PostgreSqlContainer,
  StartedPostgreSqlContainer,
} from '@testcontainers/postgresql';
import { count, eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { resolve } from 'node:path';
import postgres from 'postgres';
import { CategoryRepositoryImplementation } from './category.repository';

const MIGRATIONS_FOLDER = resolve(__dirname, '../../../../../drizzle');

jest.setTimeout(180_000);

describe('category delete against a real postgres', () => {
  let container: StartedPostgreSqlContainer;
  let queryClient: postgres.Sql;
  let moduleRef: TestingModule;
  let db: DrizzleService['db'];
  let repository: CategoryRepositoryImplementation;
  let workspaceId: string;
  let accountId: string;

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:16-alpine')
      .withStartupTimeout(120_000)
      .start();
    queryClient = postgres(container.getConnectionUri(), {
      max: 5,
      onnotice: () => undefined,
    });
    const drizzleDb = drizzle(queryClient, { schema });
    await migrate(drizzleDb, { migrationsFolder: MIGRATIONS_FOLDER });

    moduleRef = await Test.createTestingModule({
      providers: [
        DrizzleService,
        { provide: DRIZZLE_TOKEN, useValue: drizzleDb },
        CategoryRepositoryImplementation,
      ],
    }).compile();

    db = moduleRef.get(DrizzleService).db;
    repository = moduleRef.get(CategoryRepositoryImplementation);
  });

  afterAll(async () => {
    await moduleRef?.close();
    await queryClient?.end({ timeout: 5 });
    await container?.stop();
  });

  beforeEach(async () => {
    await db.execute(
      sql`DROP TRIGGER IF EXISTS test_block_category_delete ON categories`,
    );
    await db.execute(
      sql`TRUNCATE categories, transactions, budgets, budget_allocations, recurring_transactions, accounts, workspaces RESTART IDENTITY CASCADE`,
    );

    const [workspace] = await db
      .insert(schema.workspaces)
      .values({ name: 'Workspace' })
      .returning({ id: schema.workspaces.id });
    workspaceId = workspace.id;

    const [account] = await db
      .insert(schema.accounts)
      .values({
        workspaceId,
        name: 'Checking',
        type: AccountType.CHECKING,
      })
      .returning({ id: schema.accounts.id });
    accountId = account.id;
  });

  async function seedCategory(name = 'Food'): Promise<string> {
    const [category] = await db
      .insert(schema.categories)
      .values({
        workspaceId,
        name,
        type: TransactionType.EXPENSE,
      })
      .returning({ id: schema.categories.id });

    return category.id;
  }

  function makeCategory(
    overrides: Partial<{
      workspaceId: string | null;
      name: string;
      type: TransactionType;
      parentId: string | null;
      isSystemCategory: boolean;
    }> = {},
  ): Category {
    const result = Category.create({
      workspaceId,
      name: 'Food',
      type: TransactionType.EXPENSE,
      parentId: null,
      isSystemCategory: false,
      ...overrides,
    });

    if (result.isLeft()) throw result.value;
    return result.value;
  }

  async function seedTransaction(categoryId: string): Promise<void> {
    await db.insert(schema.transactions).values({
      workspaceId,
      accountId,
      categoryId,
      title: 'Groceries',
      amount: 100,
      date: new Date('2024-01-10T00:00:00.000Z'),
      type: TransactionType.EXPENSE,
      status: TransactionStatus.PENDING,
    });
  }

  async function seedAllocation(categoryId: string): Promise<void> {
    const [budget] = await db
      .insert(schema.budgets)
      .values({
        workspaceId,
        effectiveFrom: new Date('2024-01-01T00:00:00.000Z'),
        monthlyIncome: 1_000_000,
      })
      .returning({ id: schema.budgets.id });

    await db.insert(schema.budgetAllocations).values({
      budgetId: budget.id,
      categoryId,
      groupName: 'Essenciais',
      groupOrder: 0,
      categoryOrder: 0,
      percentageOfIncome: 50,
      targetCents: 500_000,
    });
  }

  async function seedRecurringRule(categoryId: string): Promise<void> {
    await db.insert(schema.recurringTransactions).values({
      workspaceId,
      accountId,
      categoryId,
      type: TransactionType.EXPENSE,
      title: 'Rent',
      amount: 1_000,
      frequency: RecurrenceFrequency.MONTHLY,
      startDate: new Date('2024-01-01T00:00:00.000Z'),
    });
  }

  it('should delete a category nothing references', async () => {
    const categoryId = await seedCategory();

    const result = await repository.deleteIfUnreferenced(
      categoryId,
      workspaceId,
    );

    expect(result).toEqual({ deleted: true });
    expect(await repository.findById(categoryId)).toBeNull();
  });

  it('should refuse to delete a category with transactions', async () => {
    const categoryId = await seedCategory();
    await seedTransaction(categoryId);
    await seedTransaction(categoryId);

    const result = await repository.deleteIfUnreferenced(
      categoryId,
      workspaceId,
    );

    expect(result).toEqual({
      deleted: false,
      references: {
        transactions: 2,
        allocations: 0,
        recurringRules: 0,
        children: 0,
      },
    });
    expect(await repository.findById(categoryId)).not.toBeNull();
  });

  it('should refuse to delete a category with budget allocations', async () => {
    const categoryId = await seedCategory();
    await seedAllocation(categoryId);

    const result = await repository.deleteIfUnreferenced(
      categoryId,
      workspaceId,
    );

    expect(result).toEqual({
      deleted: false,
      references: {
        transactions: 0,
        allocations: 1,
        recurringRules: 0,
        children: 0,
      },
    });
  });

  it('should refuse to delete a category with recurring rules', async () => {
    const categoryId = await seedCategory();
    await seedRecurringRule(categoryId);

    const result = await repository.deleteIfUnreferenced(
      categoryId,
      workspaceId,
    );

    expect(result).toEqual({
      deleted: false,
      references: {
        transactions: 0,
        allocations: 0,
        recurringRules: 1,
        children: 0,
      },
    });
  });

  it('should refuse to delete a parent category', async () => {
    const parentId = await seedCategory('Food');
    await db.insert(schema.categories).values({
      workspaceId,
      name: 'Groceries',
      type: TransactionType.EXPENSE,
      parentId,
    });

    const result = await repository.deleteIfUnreferenced(parentId, workspaceId);

    expect(result).toEqual({
      deleted: false,
      references: {
        transactions: 0,
        allocations: 0,
        recurringRules: 0,
        children: 1,
      },
    });
  });

  it('should report the category as in use when a reference appears during the delete', async () => {
    const categoryId = await seedCategory();
    await db.execute(sql`
      CREATE OR REPLACE FUNCTION test_block_category_delete() RETURNS trigger AS $$
      BEGIN
        INSERT INTO transactions (id, workspace_id, account_id, category_id, title, amount, date, type, status)
        VALUES (
          gen_random_uuid()::text,
          OLD.workspace_id,
          (SELECT id FROM accounts WHERE workspace_id = OLD.workspace_id LIMIT 1),
          OLD.id,
          'Race',
          100,
          now(),
          'EXPENSE',
          'PENDING'
        );
        RETURN OLD;
      END;
      $$ LANGUAGE plpgsql
    `);
    await db.execute(sql`
      CREATE TRIGGER test_block_category_delete
      BEFORE DELETE ON categories
      FOR EACH ROW EXECUTE FUNCTION test_block_category_delete()
    `);

    const result = await repository.deleteIfUnreferenced(
      categoryId,
      workspaceId,
    );

    expect(result.deleted).toBe(false);
    expect(await repository.findById(categoryId)).not.toBeNull();
  });

  it('should keep isHidden when the row is read back', async () => {
    const categoryId = await seedCategory();
    await db
      .update(schema.categories)
      .set({ isHidden: true })
      .where(eq(schema.categories.id, categoryId));

    const category = await repository.findById(categoryId);

    expect(category?.isHidden).toBe(true);
  });

  it('should refuse a duplicate created without a pre-check', async () => {
    await repository.create(makeCategory({ name: 'Lazer' }));

    await expect(
      repository.create(makeCategory({ name: 'Lazer' })),
    ).rejects.toBeInstanceOf(CategoryNameAlreadyExistsError);

    const [{ total }] = await db
      .select({ total: count() })
      .from(schema.categories)
      .where(eq(schema.categories.name, 'Lazer'));

    expect(total).toBe(1);
  });

  it('should allow a workspace category with a system category name', async () => {
    await db.insert(schema.categories).values({
      workspaceId: null,
      name: 'Alimentação',
      type: TransactionType.EXPENSE,
      isSystemCategory: true,
    });

    const created = await repository.create(
      makeCategory({ name: 'Alimentação' }),
    );

    expect(created.workspaceId).toBe(workspaceId);
    expect(created.isSystemCategory).toBe(false);
  });
});
