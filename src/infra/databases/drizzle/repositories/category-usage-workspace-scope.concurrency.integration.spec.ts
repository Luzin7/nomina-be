import {
  AccountType,
  TransactionStatus,
  TransactionType,
} from '@constants/enums';
import { DRIZZLE_TOKEN } from '@infra/databases/drizzle/drizzle.provider';
import { DrizzleService } from '@infra/databases/drizzle/drizzle.service';
import * as schema from '@infra/databases/drizzle/schema';
import { Test, TestingModule } from '@nestjs/testing';
import {
  PostgreSqlContainer,
  StartedPostgreSqlContainer,
} from '@testcontainers/postgresql';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { resolve } from 'node:path';
import postgres from 'postgres';
import { CategoryRepositoryImplementation } from './category.repository';

const MIGRATIONS_FOLDER = resolve(__dirname, '../../../../../drizzle');

jest.setTimeout(180_000);

describe('category usage counts against a real postgres', () => {
  let container: StartedPostgreSqlContainer;
  let queryClient: postgres.Sql;
  let moduleRef: TestingModule;
  let db: DrizzleService['db'];
  let repository: CategoryRepositoryImplementation;

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
      sql`TRUNCATE categories, workspaces RESTART IDENTITY CASCADE`,
    );
  });

  async function seedWorkspace(name: string): Promise<{
    workspaceId: string;
    accountId: string;
  }> {
    const [workspace] = await db
      .insert(schema.workspaces)
      .values({ name })
      .returning({ id: schema.workspaces.id });

    const [account] = await db
      .insert(schema.accounts)
      .values({
        workspaceId: workspace.id,
        name: 'Account',
        type: AccountType.CHECKING,
      })
      .returning({ id: schema.accounts.id });

    return { workspaceId: workspace.id, accountId: account.id };
  }

  async function insertTransaction(
    workspace: { workspaceId: string; accountId: string },
    categoryId: string,
  ): Promise<void> {
    await db.insert(schema.transactions).values({
      workspaceId: workspace.workspaceId,
      accountId: workspace.accountId,
      categoryId,
      title: 'Row',
      amount: 100,
      date: new Date(),
      type: TransactionType.EXPENSE,
      status: TransactionStatus.COMPLETED,
    });
  }

  it("excludes another workspace's transactions from a system category usage", async () => {
    const workspaceA = await seedWorkspace('Workspace A');
    const workspaceB = await seedWorkspace('Workspace B');

    const [systemCategory] = await db
      .insert(schema.categories)
      .values({
        name: 'System',
        type: TransactionType.EXPENSE,
        isSystemCategory: true,
      })
      .returning({ id: schema.categories.id });

    await insertTransaction(workspaceA, systemCategory.id);
    await insertTransaction(workspaceB, systemCategory.id);

    const { usageCounts } = await repository.findManyByWorkspaceId(
      workspaceA.workspaceId,
      { visibility: 'all' },
    );

    expect(usageCounts[systemCategory.id]).toBe(1);
  });
});
