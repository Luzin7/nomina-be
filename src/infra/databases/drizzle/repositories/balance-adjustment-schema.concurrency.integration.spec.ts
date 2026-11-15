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
const WORKSPACE_ID = 'ws-adjustment';
const ACCOUNT_ID = 'acc-adjustment';
const ACTOR_ID = 'user-adjustment';
const FOREIGN_KEY_VIOLATION = '23503';
const UNIQUE_VIOLATION = '23505';

jest.setTimeout(180_000);

describe('balance_adjustments schema', () => {
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
    await db.execute(
      sql`TRUNCATE users, accounts, balance_movements, balance_adjustments, workspaces CASCADE`,
    );
    await db.insert(schema.users).values({
      id: ACTOR_ID,
      email: 'adjustment@example.com',
      passwordHash: 'hash',
      name: 'Adjustment',
    });
    await db
      .insert(schema.workspaces)
      .values({ id: WORKSPACE_ID, name: 'Adjustment' });
    await db.insert(schema.accounts).values({
      id: ACCOUNT_ID,
      workspaceId: WORKSPACE_ID,
      name: 'Checking',
      type: 'CHECKING',
      balance: 1000,
    });
  });

  async function insertMovement(): Promise<number> {
    const [movement] = await db
      .insert(schema.balanceMovements)
      .values({
        workspaceId: WORKSPACE_ID,
        accountId: ACCOUNT_ID,
        cause: 'RECONCILIATION',
        delta: 500,
        balanceAfter: 1500,
        actorId: ACTOR_ID,
      } as typeof schema.balanceMovements.$inferInsert)
      .returning({ seq: schema.balanceMovements.seq });
    return movement.seq;
  }

  function insertAdjustment(id: string, movementSeq: number) {
    return db.execute(sql`
      INSERT INTO balance_adjustments
        (id, workspace_id, account_id, actor_id, expected_balance_cents,
         target_balance_cents, delta_cents, movement_seq)
      VALUES
        (${id}, ${WORKSPACE_ID}, ${ACCOUNT_ID}, ${ACTOR_ID}, 1000, 1500, 500,
         ${movementSeq})
    `);
  }

  async function countAdjustments(): Promise<number> {
    const rows = await db.execute<{ total: number }>(
      sql`SELECT count(*)::int AS total FROM balance_adjustments`,
    );
    return rows[0].total;
  }

  async function countMovements(): Promise<number> {
    const rows = await db.execute<{ total: number }>(
      sql`SELECT count(*)::int AS total FROM balance_movements`,
    );
    return rows[0].total;
  }

  it('rejects an unknown movement_seq', async () => {
    await expect(insertAdjustment('adj-1', 999999)).rejects.toMatchObject({
      cause: { code: FOREIGN_KEY_VIOLATION },
    });
  });

  it('rejects a duplicate id', async () => {
    const seq = await insertMovement();
    await insertAdjustment('adj-1', seq);

    await expect(insertAdjustment('adj-1', seq)).rejects.toMatchObject({
      cause: { code: UNIQUE_VIOLATION },
    });
  });

  it('deletes adjustments with the account and keeps the movements', async () => {
    const seq = await insertMovement();
    await insertAdjustment('adj-1', seq);

    await db.execute(sql`DELETE FROM accounts WHERE id = ${ACCOUNT_ID}`);

    expect(await countAdjustments()).toBe(0);
    expect(await countMovements()).toBe(1);
  });

  it('deletes adjustments with the workspace', async () => {
    const seq = await insertMovement();
    await insertAdjustment('adj-1', seq);

    await db.execute(sql`DELETE FROM workspaces WHERE id = ${WORKSPACE_ID}`);

    expect(await countAdjustments()).toBe(0);
  });
});
