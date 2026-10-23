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
import {
  applyInstallmentCountBackfill,
  readDryRunReport,
} from './backfill-recurring-installment-count';

const MIGRATIONS_FOLDER = resolve(__dirname, '../drizzle');
const PRE_CHECK_FILE = resolve(
  MIGRATIONS_FOLDER,
  'pre-checks/0023_recurring_installment_count.sql',
);
const PRE_MIGRATION_CHECK_FILE = resolve(
  MIGRATIONS_FOLDER,
  'pre-checks/0023_recurring_installment_count.pre-migration.sql',
);
const SAO_PAULO = 'America/Sao_Paulo';
const NEW_YORK = 'America/New_York';
const LISBON = 'Europe/Lisbon';

jest.setTimeout(180_000);

type RecurringSeed = {
  accountId: string;
  type?: string;
  frequency: string;
  interval?: number;
  startDate: string;
  endDate: string | null;
  installmentCount?: number | null;
};

describe('backfill recurring installment_count', () => {
  let container: StartedPostgreSqlContainer;
  let queryClient: postgres.Sql;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  let workspaceId: string;
  let categoryId: string;
  let cardSaoPaulo: string;
  let cardNewYork: string;
  let cardLisbon: string;
  let checking: string;

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:16-alpine')
      .withStartupTimeout(120_000)
      .start();
    queryClient = postgres(container.getConnectionUri(), {
      max: 4,
      onnotice: () => undefined,
    });
    db = drizzle(queryClient, { schema });
    await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });

    workspaceId = randomUUID();
    categoryId = randomUUID();
    cardSaoPaulo = randomUUID();
    cardNewYork = randomUUID();
    cardLisbon = randomUUID();
    checking = randomUUID();

    await db.insert(schema.workspaces).values({ id: workspaceId, name: 'ws' });
    await db
      .insert(schema.categories)
      .values({ id: categoryId, workspaceId, name: 'cat', type: 'EXPENSE' });
    await db.insert(schema.accounts).values([
      {
        id: cardSaoPaulo,
        workspaceId,
        name: 'card sp',
        type: 'CREDIT_CARD',
        timezone: SAO_PAULO,
      },
      {
        id: cardNewYork,
        workspaceId,
        name: 'card ny',
        type: 'CREDIT_CARD',
        timezone: NEW_YORK,
      },
      {
        id: cardLisbon,
        workspaceId,
        name: 'card lisbon',
        type: 'CREDIT_CARD',
        timezone: LISBON,
      },
      {
        id: checking,
        workspaceId,
        name: 'checking',
        type: 'CHECKING',
        timezone: SAO_PAULO,
      },
    ]);
  });

  afterAll(async () => {
    await queryClient?.end({ timeout: 5 });
    await container?.stop();
  });

  async function seed(row: RecurringSeed): Promise<string> {
    const id = randomUUID();
    await db.insert(schema.recurringTransactions).values({
      id,
      workspaceId,
      accountId: row.accountId,
      categoryId,
      type: row.type ?? 'EXPENSE',
      title: 'seed',
      amount: 1000,
      frequency: row.frequency,
      interval: row.interval ?? 1,
      startDate: new Date(row.startDate),
      endDate: row.endDate ? new Date(row.endDate) : null,
      installmentCount: row.installmentCount ?? null,
    });

    return id;
  }

  async function runPreCheck(
    databaseUri: string,
    file: string,
  ): Promise<Record<string, unknown>[]> {
    const singleConnection = postgres(databaseUri, {
      max: 1,
      onnotice: () => undefined,
    });
    try {
      const results = await singleConnection
        .unsafe(readFileSync(file, 'utf8'))
        .simple();

      return (results as unknown as Record<string, unknown>[][]).flat();
    } finally {
      await singleConnection.end({ timeout: 5 });
    }
  }

  function sectionValue(
    rows: Record<string, unknown>[],
    section: string,
  ): unknown {
    return rows.find((row) => row.section === section)?.value;
  }

  async function installmentCountOf(id: string): Promise<number | null> {
    const [row] = await queryClient<{ installment_count: number | null }[]>`
      SELECT installment_count FROM recurring_transactions WHERE id = ${id}
    `;

    return row.installment_count;
  }

  it('should infer installments from the schedule, leave other rows alone and change nothing on a second run', async () => {
    const monthly = await seed({
      accountId: cardSaoPaulo,
      frequency: 'MONTHLY',
      startDate: '2099-01-15T03:00:00Z',
      endDate: '2099-06-15T03:00:00Z',
    });
    const weekly = await seed({
      accountId: cardSaoPaulo,
      frequency: 'WEEKLY',
      startDate: '2099-01-05T03:00:00Z',
      endDate: '2099-01-26T03:00:00Z',
    });
    const everyTwoMonths = await seed({
      accountId: cardSaoPaulo,
      frequency: 'MONTHLY',
      interval: 2,
      startDate: '2099-01-10T03:00:00Z',
      endDate: '2099-09-10T03:00:00Z',
    });
    const endOfMonthClamp = await seed({
      accountId: cardSaoPaulo,
      frequency: 'MONTHLY',
      startDate: '2099-01-31T03:00:00Z',
      endDate: '2099-04-30T03:00:00Z',
    });
    const yearly = await seed({
      accountId: cardSaoPaulo,
      frequency: 'YEARLY',
      startDate: '2099-03-01T03:00:00Z',
      endDate: '2101-03-01T03:00:00Z',
    });
    const weeklyAcrossDst = await seed({
      accountId: cardNewYork,
      frequency: 'WEEKLY',
      startDate: '2099-03-02T05:00:00Z',
      endDate: '2099-03-23T04:00:00Z',
    });
    const weeklyAcrossDstStoredByDayjs = await seed({
      accountId: cardNewYork,
      frequency: 'WEEKLY',
      startDate: '2099-03-02T05:00:00Z',
      endDate: '2099-03-23T05:00:00Z',
    });
    const monthlyInLisbon = await seed({
      accountId: cardLisbon,
      frequency: 'MONTHLY',
      startDate: '2099-01-15T00:00:00Z',
      endDate: '2099-06-14T23:00:00Z',
    });
    const single = await seed({
      accountId: cardSaoPaulo,
      frequency: 'MONTHLY',
      startDate: '2099-05-01T03:00:00Z',
      endDate: '2099-05-01T03:00:00Z',
    });
    const offGrid = await seed({
      accountId: cardSaoPaulo,
      frequency: 'MONTHLY',
      startDate: '2099-01-15T03:00:00Z',
      endDate: '2099-06-20T03:00:00Z',
    });
    const checkingAccount = await seed({
      accountId: checking,
      frequency: 'MONTHLY',
      startDate: '2099-01-15T03:00:00Z',
      endDate: '2099-06-15T03:00:00Z',
    });
    const income = await seed({
      accountId: cardSaoPaulo,
      type: 'INCOME',
      frequency: 'MONTHLY',
      startDate: '2099-01-15T03:00:00Z',
      endDate: '2099-06-15T03:00:00Z',
    });
    const noEndDate = await seed({
      accountId: cardSaoPaulo,
      frequency: 'MONTHLY',
      startDate: '2099-01-15T03:00:00Z',
      endDate: null,
    });
    const alreadyFilled = await seed({
      accountId: cardSaoPaulo,
      frequency: 'MONTHLY',
      startDate: '2099-01-15T03:00:00Z',
      endDate: '2099-06-15T03:00:00Z',
      installmentCount: 9,
    });

    const report = await readDryRunReport(queryClient);
    const preCheckRows = await runPreCheck(
      container.getConnectionUri(),
      PRE_CHECK_FILE,
    );
    const preCheckInferred = preCheckRows
      .filter((row) => row.section === 'sample_inferred')
      .map((row) => row.id)
      .sort();

    expect(report.candidates).toBe(10);
    expect(report.unmatchedIds).toEqual([offGrid]);
    expect(preCheckInferred).toEqual(
      report.inferred.map((row) => row.id).sort(),
    );
    expect(sectionValue(preCheckRows, 'candidates')).toBe(10);
    expect(sectionValue(preCheckRows, 'candidates_in_dst_zones')).toBe(3);
    expect(
      preCheckRows.find((row) => row.section === 'suspect_single')?.id,
    ).toBe(single);

    expect(await applyInstallmentCountBackfill(queryClient)).toBe(9);
    expect(await installmentCountOf(monthly)).toBe(6);
    expect(await installmentCountOf(weekly)).toBe(4);
    expect(await installmentCountOf(everyTwoMonths)).toBe(5);
    expect(await installmentCountOf(endOfMonthClamp)).toBe(4);
    expect(await installmentCountOf(yearly)).toBe(3);
    expect(await installmentCountOf(weeklyAcrossDst)).toBe(4);
    expect(await installmentCountOf(weeklyAcrossDstStoredByDayjs)).toBe(4);
    expect(await installmentCountOf(monthlyInLisbon)).toBe(6);
    expect(await installmentCountOf(single)).toBe(1);
    expect(await installmentCountOf(offGrid)).toBeNull();
    expect(await installmentCountOf(checkingAccount)).toBeNull();
    expect(await installmentCountOf(income)).toBeNull();
    expect(await installmentCountOf(noEndDate)).toBeNull();
    expect(await installmentCountOf(alreadyFilled)).toBe(9);

    expect(await applyInstallmentCountBackfill(queryClient)).toBe(0);
  });

  it('should run the pre-migration check against a schema without the column', async () => {
    const adminConnection = postgres(container.getConnectionUri(), {
      max: 1,
      onnotice: () => undefined,
    });
    await adminConnection.unsafe('CREATE DATABASE pre_migration');
    await adminConnection.end({ timeout: 5 });

    const preMigrationUri = new URL(container.getConnectionUri());
    preMigrationUri.pathname = '/pre_migration';
    const legacyClient = postgres(preMigrationUri.toString(), {
      max: 1,
      onnotice: () => undefined,
    });
    await migrate(drizzle(legacyClient, { schema }), {
      migrationsFolder: MIGRATIONS_FOLDER,
    });
    await legacyClient.unsafe(
      'ALTER TABLE recurring_transactions DROP COLUMN installment_count',
    );
    await legacyClient`INSERT INTO workspaces (id, name) VALUES (${workspaceId}, 'ws')`;
    await legacyClient`INSERT INTO accounts (id, workspace_id, name, type, time_zone) VALUES (${cardSaoPaulo}, ${workspaceId}, 'card', 'CREDIT_CARD', ${SAO_PAULO})`;
    await legacyClient`INSERT INTO categories (id, workspace_id, name, type) VALUES (${categoryId}, ${workspaceId}, 'cat', 'EXPENSE')`;
    await legacyClient`
      INSERT INTO recurring_transactions
        (id, workspace_id, account_id, category_id, type, title, amount, frequency, interval, start_date, end_date)
      VALUES
        (${randomUUID()}, ${workspaceId}, ${cardSaoPaulo}, ${categoryId}, 'EXPENSE', 'seed', 1000, 'MONTHLY', 1,
         '2099-01-15T03:00:00Z', '2099-06-15T03:00:00Z')
    `;
    await legacyClient.end({ timeout: 5 });

    const rows = await runPreCheck(
      preMigrationUri.toString(),
      PRE_MIGRATION_CHECK_FILE,
    );

    expect(sectionValue(rows, 'candidates')).toBe(1);
    expect(sectionValue(rows, 'inferred')).toBe(1);
    expect(sectionValue(rows, 'unmatched')).toBe(0);
  });
});
