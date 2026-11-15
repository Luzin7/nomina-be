import * as schema from '@infra/databases/drizzle/schema';
import {
  PostgreSqlContainer,
  StartedPostgreSqlContainer,
} from '@testcontainers/postgresql';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { resolve } from 'node:path';
import postgres from 'postgres';

const MIGRATIONS_FOLDER = resolve(__dirname, '../../../../../drizzle');
const WORKSPACE_ID = 'ws-goal-source';
const ACCOUNT_ID = 'acc-goal-source';
const CHECK_VIOLATION = '23514';
const UNIQUE_VIOLATION = '23505';

jest.setTimeout(180_000);

describe('goals progress_source schema', () => {
  let container: StartedPostgreSqlContainer;
  let queryClient: postgres.Sql;
  let db: ReturnType<typeof drizzle>;

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:16-alpine')
      .withStartupTimeout(120_000)
      .start();
    queryClient = postgres(container.getConnectionUri(), {
      max: 5,
      onnotice: () => undefined,
    });
    db = drizzle(queryClient, { schema });
    await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
  });

  afterAll(async () => {
    await queryClient.end({ timeout: 5 });
    await container.stop();
  });

  beforeEach(async () => {
    await db.execute(sql`TRUNCATE accounts, goals, workspaces CASCADE`);
    await db
      .insert(schema.workspaces)
      .values({ id: WORKSPACE_ID, name: 'Goal source' });
    await db.insert(schema.accounts).values({
      id: ACCOUNT_ID,
      workspaceId: WORKSPACE_ID,
      name: 'Reserve',
      type: 'CASH',
      balance: 1000,
    });
  });

  function insertGoal(
    id: string,
    progressSource: string | null,
    linkedAccountId: string | null,
  ) {
    return db.execute(sql`
      INSERT INTO goals (id, workspace_id, name, progress_source, linked_account_id)
      VALUES (${id}, ${WORKSPACE_ID}, ${id}, ${progressSource}, ${linkedAccountId})
    `);
  }

  async function countGoals(): Promise<number> {
    const rows = await db.execute<{ total: number }>(
      sql`SELECT count(*)::int AS total FROM goals`,
    );
    return rows[0].total;
  }

  it('defaults progress_source to manual', async () => {
    await db.execute(sql`
      INSERT INTO goals (id, workspace_id, name)
      VALUES ('goal-default', ${WORKSPACE_ID}, 'Default')
    `);

    const rows = await db.execute<{ progress_source: string }>(
      sql`SELECT progress_source FROM goals WHERE id = 'goal-default'`,
    );

    expect(rows[0].progress_source).toBe('manual');
  });

  it('rejects an account source without a linked account', async () => {
    await expect(insertGoal('goal-1', 'account', null)).rejects.toMatchObject({
      cause: { code: CHECK_VIOLATION },
    });
  });

  it('rejects an unknown progress_source', async () => {
    await expect(
      insertGoal('goal-1', 'other', ACCOUNT_ID),
    ).rejects.toMatchObject({ cause: { code: CHECK_VIOLATION } });
  });

  it('rejects two account goals on one account', async () => {
    await insertGoal('goal-1', 'account', ACCOUNT_ID);

    await expect(
      insertGoal('goal-2', 'account', ACCOUNT_ID),
    ).rejects.toMatchObject({ cause: { code: UNIQUE_VIOLATION } });
  });

  it('accepts two manual goals on one account', async () => {
    await insertGoal('goal-1', 'manual', ACCOUNT_ID);
    await insertGoal('goal-2', 'manual', ACCOUNT_ID);

    expect(await countGoals()).toBe(2);
  });

  it('refuses to delete an account that backs an account goal', async () => {
    await insertGoal('goal-1', 'account', ACCOUNT_ID);

    await expect(
      db.execute(sql`DELETE FROM accounts WHERE id = ${ACCOUNT_ID}`),
    ).rejects.toMatchObject({ cause: { code: CHECK_VIOLATION } });
  });

  it('deletes a workspace that holds an account goal', async () => {
    await insertGoal('goal-1', 'account', ACCOUNT_ID);

    await db.execute(sql`DELETE FROM workspaces WHERE id = ${WORKSPACE_ID}`);

    expect(await countGoals()).toBe(0);
  });
});
