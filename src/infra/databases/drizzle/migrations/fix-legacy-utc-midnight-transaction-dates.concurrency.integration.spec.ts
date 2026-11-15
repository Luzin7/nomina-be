import {
  AccountType,
  TransactionStatus,
  TransactionType,
} from '@constants/enums';
import * as schema from '@infra/databases/drizzle/schema';
import {
  PostgreSqlContainer,
  StartedPostgreSqlContainer,
} from '@testcontainers/postgresql';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import postgres from 'postgres';

const MIGRATIONS_FOLDER = resolve(__dirname, '../../../../../drizzle');
const MIGRATION_SQL = readFileSync(
  resolve(
    MIGRATIONS_FOLDER,
    '0043_fix_legacy_utc_midnight_transaction_dates.sql',
  ),
  'utf8',
);
const SAO_PAULO = 'America/Sao_Paulo';
const LEGACY_CREATED_AT = new Date('2026-03-10T12:00:00Z');
const RECENT_CREATED_AT = new Date('2026-05-10T12:00:00Z');

jest.setTimeout(180_000);

describe('migration 0043 legacy UTC midnight transaction dates', () => {
  let container: StartedPostgreSqlContainer;
  let adminClient: postgres.Sql;
  let db: ReturnType<typeof drizzle<typeof schema>>;

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:16-alpine')
      .withStartupTimeout(120_000)
      .start();
    adminClient = postgres(container.getConnectionUri(), {
      max: 1,
      onnotice: () => undefined,
    });
    db = drizzle(adminClient, { schema });
    await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
  });

  afterAll(async () => {
    await adminClient.end({ timeout: 5 });
    await container.stop();
  });

  async function seedWorkspace(timezone = SAO_PAULO) {
    const workspaceId = randomUUID();
    const accountId = randomUUID();
    const categoryId = randomUUID();
    await db
      .insert(schema.workspaces)
      .values({ id: workspaceId, name: 'WS', timezone });
    await db.insert(schema.accounts).values({
      id: accountId,
      workspaceId,
      name: 'Account',
      type: AccountType.CHECKING,
    });
    await db.insert(schema.categories).values({
      id: categoryId,
      workspaceId,
      name: 'Category',
      type: TransactionType.EXPENSE,
    });
    return { workspaceId, accountId, categoryId };
  }

  async function insertTransaction(
    seed: Awaited<ReturnType<typeof seedWorkspace>>,
    date: string,
    createdAt: Date = LEGACY_CREATED_AT,
  ) {
    const id = randomUUID();
    await db.insert(schema.transactions).values({
      id,
      title: 'Transaction',
      amount: 1_000,
      type: TransactionType.EXPENSE,
      status: TransactionStatus.COMPLETED,
      date: new Date(date),
      createdAt,
      ...seed,
    });
    return id;
  }

  async function readRow(id: string) {
    const [row] = await adminClient<
      { date: string; updated_at: Date | null }[]
    >`SELECT to_char(date AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS date, updated_at FROM transactions WHERE id = ${id}`;
    return row;
  }

  async function runMigration(sessionTimeZone: string) {
    const client = postgres(container.getConnectionUri(), {
      max: 1,
      onnotice: () => undefined,
      connection: { TimeZone: sessionTimeZone },
    });
    try {
      return (await client.unsafe(MIGRATION_SQL)).count;
    } finally {
      await client.end({ timeout: 5 });
    }
  }

  it('should move a legacy UTC midnight row to local midnight of the same calendar date', async () => {
    const seed = await seedWorkspace();
    const id = await insertTransaction(seed, '2026-03-01T00:00:00Z');

    await runMigration('UTC');

    expect((await readRow(id)).date).toBe('2026-03-01T03:00:00Z');
  });

  it('should leave local midnight, non midnight and post cutoff rows untouched', async () => {
    const seed = await seedWorkspace();
    const localMidnight = await insertTransaction(seed, '2026-03-05T03:00:00Z');
    const midday = await insertTransaction(seed, '2026-03-05T15:00:00Z');
    const postCutoff = await insertTransaction(
      seed,
      '2026-05-05T00:00:00Z',
      RECENT_CREATED_AT,
    );
    const utcWorkspace = await seedWorkspace('UTC');
    const utcWorkspaceRow = await insertTransaction(
      utcWorkspace,
      '2026-03-05T00:00:00Z',
    );

    await runMigration('UTC');

    expect((await readRow(localMidnight)).date).toBe('2026-03-05T03:00:00Z');
    expect((await readRow(midday)).date).toBe('2026-03-05T15:00:00Z');
    expect((await readRow(postCutoff)).date).toBe('2026-05-05T00:00:00Z');
    expect((await readRow(utcWorkspaceRow)).date).toBe('2026-03-05T00:00:00Z');
  });

  it('should not change updated_at', async () => {
    const seed = await seedWorkspace();
    const id = await insertTransaction(seed, '2026-03-02T00:00:00Z');
    const before = (await readRow(id)).updated_at;

    await runMigration('UTC');

    expect((await readRow(id)).updated_at).toEqual(before);
  });

  it('should touch zero rows when run again', async () => {
    const seed = await seedWorkspace();
    await insertTransaction(seed, '2026-03-03T00:00:00Z');
    await runMigration('UTC');

    expect(await runMigration('UTC')).toBe(0);
  });

  it.each(['UTC', 'America/Recife'])(
    'should produce the same result with session time zone %s',
    async (sessionTimeZone) => {
      const seed = await seedWorkspace();
      const id = await insertTransaction(seed, '2026-04-01T00:00:00Z');

      await runMigration(sessionTimeZone);

      expect((await readRow(id)).date).toBe('2026-04-01T03:00:00Z');
    },
  );
});
