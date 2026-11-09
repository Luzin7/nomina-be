import * as schema from '@infra/databases/drizzle/schema';
import {
  PostgreSqlContainer,
  StartedPostgreSqlContainer,
} from '@testcontainers/postgresql';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import postgres from 'postgres';
import { runDefaultCategoryBackfill } from './backfill-default-categories';

const MIGRATIONS_FOLDER = resolve(__dirname, '../drizzle');
const DEFAULT_CATEGORY_NODES = 38;

jest.setTimeout(180_000);

describe('backfill default categories', () => {
  let container: StartedPostgreSqlContainer;
  let sql: postgres.Sql;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  let workspaceId: string;

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:16-alpine')
      .withStartupTimeout(120_000)
      .start();
    sql = postgres(container.getConnectionUri(), {
      max: 4,
      onnotice: () => undefined,
    });
    db = drizzle(sql, { schema });
    await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
  });

  afterAll(async () => {
    await sql?.end({ timeout: 5 });
    await container?.stop();
  });

  beforeEach(async () => {
    await sql`DELETE FROM categories WHERE workspace_id IS NOT NULL`;
    await sql`DELETE FROM workspaces`;
    workspaceId = randomUUID();
    await db.insert(schema.workspaces).values({ id: workspaceId, name: 'ws' });
  });

  it('inserts the default tree once and skips everything on a second run', async () => {
    const first = await runDefaultCategoryBackfill(sql, 'apply');
    const second = await runDefaultCategoryBackfill(sql, 'apply');

    expect(first).toEqual({
      workspaces: 1,
      inserted: DEFAULT_CATEGORY_NODES,
      skipped: 0,
    });
    expect(second).toEqual({
      workspaces: 1,
      inserted: 0,
      skipped: DEFAULT_CATEGORY_NODES,
    });

    const categories = await db
      .select()
      .from(schema.categories)
      .where(eq(schema.categories.workspaceId, workspaceId));

    expect(categories).toHaveLength(DEFAULT_CATEGORY_NODES);
    expect(
      categories.filter(
        (category) =>
          category.name === 'Investimentos' &&
          category.type === 'EXPENSE' &&
          category.parentId === null,
      ),
    ).toHaveLength(1);
  });

  it('lets two concurrent applies finish without duplicating top-level categories', async () => {
    const workspaceIds = [workspaceId, randomUUID(), randomUUID()];
    await db
      .insert(schema.workspaces)
      .values(workspaceIds.slice(1).map((id) => ({ id, name: 'ws' })));

    const [first, second] = await Promise.all([
      runDefaultCategoryBackfill(sql, 'apply'),
      runDefaultCategoryBackfill(sql, 'apply'),
    ]);

    expect(first.workspaces).toBe(3);
    expect(second.workspaces).toBe(3);
    expect(
      [first.inserted, second.inserted].sort((left, right) => left - right),
    ).toEqual([0, DEFAULT_CATEGORY_NODES * 3]);

    for (const id of workspaceIds) {
      const categories = await db
        .select()
        .from(schema.categories)
        .where(eq(schema.categories.workspaceId, id));

      expect(categories).toHaveLength(DEFAULT_CATEGORY_NODES);
      for (const type of ['EXPENSE', 'INCOME']) {
        expect(
          categories.filter(
            (category) =>
              category.name === 'Investimentos' &&
              category.type === type &&
              category.parentId === null,
          ),
        ).toHaveLength(1);
      }
    }
  });
});
