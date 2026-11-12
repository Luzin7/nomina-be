import { TransactionType } from '@constants/enums';
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

describe('category list visibility against a real postgres', () => {
  let container: StartedPostgreSqlContainer;
  let queryClient: postgres.Sql;
  let moduleRef: TestingModule;
  let db: DrizzleService['db'];
  let repository: CategoryRepositoryImplementation;
  let workspaceId: string;
  let rootId: string;
  let childId: string;
  let hiddenId: string;

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

    const [workspace] = await db
      .insert(schema.workspaces)
      .values({ name: 'Workspace' })
      .returning({ id: schema.workspaces.id });
    workspaceId = workspace.id;

    const [root] = await db
      .insert(schema.categories)
      .values({
        workspaceId,
        name: 'Alimentação',
        type: TransactionType.EXPENSE,
      })
      .returning({ id: schema.categories.id });
    rootId = root.id;

    const [child] = await db
      .insert(schema.categories)
      .values({
        workspaceId,
        name: 'Mercado',
        type: TransactionType.EXPENSE,
        parentId: rootId,
      })
      .returning({ id: schema.categories.id });
    childId = child.id;

    const [hidden] = await db
      .insert(schema.categories)
      .values({
        workspaceId,
        name: 'Lazer',
        type: TransactionType.EXPENSE,
        isHidden: true,
      })
      .returning({ id: schema.categories.id });
    hiddenId = hidden.id;
  });

  it('excludes hidden rows from list and count', async () => {
    const { categories, total } = await repository.findManyByWorkspaceId(
      workspaceId,
      { visibility: 'visible' },
    );

    expect(categories.map((category) => category.id).sort()).toEqual(
      [rootId, childId].sort(),
    );
    expect(total).toBe(2);
  });

  it('returns all rows with isHidden mapped', async () => {
    const { categories, total } = await repository.findManyByWorkspaceId(
      workspaceId,
      { visibility: 'all' },
    );

    expect(categories.map((category) => category.id).sort()).toEqual(
      [rootId, childId, hiddenId].sort(),
    );
    expect(total).toBe(3);
    expect(
      categories.find((category) => category.id === hiddenId)?.isHidden,
    ).toBe(true);
    expect(
      categories.find((category) => category.id === rootId)?.isHidden,
    ).toBe(false);
  });
});
