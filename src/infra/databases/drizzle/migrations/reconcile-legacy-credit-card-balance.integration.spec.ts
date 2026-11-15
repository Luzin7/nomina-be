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
const MIGRATION_FILE = '0044_reconcile_legacy_credit_card_balance.sql';
const MIGRATION_SQL = readFileSync(
  resolve(MIGRATIONS_FOLDER, MIGRATION_FILE),
  'utf8',
);
const DRIFT_CENTS = 124_858;

jest.setTimeout(180_000);

describe('migration 0044 reconcile legacy credit card balance', () => {
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

  async function seedCard(
    ledgerExpenseCents: number,
    storedBalance: number,
    type: AccountType = AccountType.CREDIT_CARD,
  ) {
    const workspaceId = randomUUID();
    const accountId = randomUUID();
    const categoryId = randomUUID();
    await db
      .insert(schema.workspaces)
      .values({ id: workspaceId, name: 'WS', timezone: 'America/Sao_Paulo' });
    await db.insert(schema.accounts).values({
      id: accountId,
      workspaceId,
      name: 'Card',
      type,
      balance: storedBalance,
    });
    await db.insert(schema.categories).values({
      id: categoryId,
      workspaceId,
      name: 'Category',
      type: TransactionType.EXPENSE,
    });
    await db.insert(schema.transactions).values({
      id: randomUUID(),
      workspaceId,
      accountId,
      categoryId,
      title: 'Legacy expense',
      amount: ledgerExpenseCents,
      type: TransactionType.EXPENSE,
      status: TransactionStatus.COMPLETED,
      date: new Date('2026-03-01T12:00:00Z'),
    });
    return accountId;
  }

  async function readBalance(accountId: string) {
    const [row] = await adminClient<
      { balance: string }[]
    >`SELECT balance FROM accounts WHERE id = ${accountId}`;
    return Number(row.balance);
  }

  async function readMovements(accountId: string) {
    return adminClient<
      {
        cause: string;
        delta: string;
        balance_after: string;
        transaction_id: string | null;
        actor_id: string | null;
      }[]
    >`SELECT cause, delta, balance_after, transaction_id, actor_id FROM balance_movements WHERE account_id = ${accountId}`;
  }

  async function readSnapshot() {
    const [row] = await adminClient<
      { movements: string; balances: string }[]
    >`SELECT
        (SELECT count(*) FROM balance_movements) AS movements,
        (SELECT COALESCE(sum(balance), 0) FROM accounts) AS balances`;
    return row;
  }

  async function runMigration() {
    const client = postgres(container.getConnectionUri(), {
      max: 1,
      onnotice: () => undefined,
    });
    try {
      await client.unsafe(MIGRATION_SQL);
    } finally {
      await client.end({ timeout: 5 });
    }
  }

  it('should fix the drifting card and write the reconciliation movement', async () => {
    const accountId = await seedCard(DRIFT_CENTS + 500, 500);

    await runMigration();

    expect(await readBalance(accountId)).toBe(DRIFT_CENTS + 500);
    expect(await readMovements(accountId)).toEqual([
      {
        cause: 'RECONCILIATION',
        delta: String(DRIFT_CENTS),
        balance_after: String(DRIFT_CENTS + 500),
        transaction_id: null,
        actor_id: null,
      },
    ]);
  });

  it('should leave a card with another delta untouched', async () => {
    const accountId = await seedCard(5_000, 0);

    await runMigration();

    expect(await readBalance(accountId)).toBe(0);
    expect(await readMovements(accountId)).toEqual([]);
  });

  it('should leave a non credit card account with the same delta untouched', async () => {
    const accountId = await seedCard(DRIFT_CENTS, 0, AccountType.CHECKING);

    await runMigration();

    expect(await readBalance(accountId)).toBe(0);
    expect(await readMovements(accountId)).toEqual([]);
  });

  it('should insert nothing and change no balance when no card qualifies', async () => {
    await seedCard(5_000, 0);
    const before = await readSnapshot();

    await runMigration();

    expect(await readSnapshot()).toEqual(before);
  });

  it('should be a no-op when run again', async () => {
    const accountId = await seedCard(DRIFT_CENTS, 0);
    await runMigration();

    await runMigration();

    expect(await readBalance(accountId)).toBe(DRIFT_CENTS);
    expect(await readMovements(accountId)).toHaveLength(1);
  });
});
