import { DRIZZLE_TOKEN } from '@infra/databases/drizzle/drizzle.provider';
import { DrizzleService } from '@infra/databases/drizzle/drizzle.service';
import * as schema from '@infra/databases/drizzle/schema';
import { Test, TestingModule } from '@nestjs/testing';
import {
  PostgreSqlContainer,
  StartedPostgreSqlContainer,
} from '@testcontainers/postgresql';
import { eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { randomUUID } from 'node:crypto';
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import postgres from 'postgres';
import { RecurringTransactionRepositoryImplementation } from './recurring-transaction.repository';

jest.mock('@sentry/nestjs', () => ({ captureException: jest.fn() }));

const MIGRATIONS_FOLDER = resolve(__dirname, '../../../../../drizzle');
const PRISMA_FK_NAME = 'transactions_recurring_transaction_id_fkey';
const DRIZZLE_FK_NAME =
  'transactions_recurring_transaction_id_recurring_transactions_id';
const LAST_PRISMA_ERA_MIGRATION_TAG = '0037_budget_suggestion_seed';

const TIMEZONE = 'America/Sao_Paulo';
const TODAY_START = new Date('2026-03-15T03:00:00.000Z');
const TODAY = new Date('2026-03-15T15:00:00.000Z');
const LAST_MONTH = new Date('2026-02-15T03:00:00.000Z');
const NEXT_MONTH = new Date('2026-04-15T03:00:00.000Z');
const UTC_TOMORROW_TODAY_LOCAL = new Date('2026-03-16T01:00:00.000Z');
const TOKYO_TIMEZONE = 'Asia/Tokyo';
const TOKYO_TODAY_START = new Date('2026-03-14T15:00:00.000Z');
const UTC_TODAY_TOKYO_TOMORROW = new Date('2026-03-15T20:00:00.000Z');

function buildFolderUntil(lastTag: string) {
  const folder = mkdtempSync(join(tmpdir(), 'drizzle-until-'));
  cpSync(MIGRATIONS_FOLDER, folder, { recursive: true });
  const journalPath = join(folder, 'meta', '_journal.json');
  const journal = JSON.parse(readFileSync(journalPath, 'utf8'));
  const lastPosition = journal.entries.findIndex(
    (entry: { tag: string }) => entry.tag === lastTag,
  );
  journal.entries = journal.entries.slice(0, lastPosition + 1);
  writeFileSync(journalPath, JSON.stringify(journal));
  return folder;
}

jest.setTimeout(180_000);

type Db = DrizzleService['db'];

type Owner = {
  workspaceId: string;
  accountId: string;
  categoryId: string;
};

async function seedWorkspace(db: Db): Promise<Owner> {
  const workspaceId = randomUUID();
  const accountId = randomUUID();
  const categoryId = randomUUID();

  await db
    .insert(schema.workspaces)
    .values({ id: workspaceId, name: 'Workspace' });
  await db.insert(schema.accounts).values({
    id: accountId,
    workspaceId,
    name: 'Account',
    type: 'CHECKING',
  });
  await db.insert(schema.categories).values({
    id: categoryId,
    workspaceId,
    name: 'Category',
    type: 'EXPENSE',
  });

  return { workspaceId, accountId, categoryId };
}

async function seedRule(db: Db, owner: Owner): Promise<string> {
  const recurringId = randomUUID();

  await db.insert(schema.recurringTransactions).values({
    id: recurringId,
    workspaceId: owner.workspaceId,
    accountId: owner.accountId,
    categoryId: owner.categoryId,
    type: 'EXPENSE',
    title: 'Rent',
    amount: 1000,
    frequency: 'MONTHLY',
    startDate: new Date('2026-01-01T00:00:00Z'),
  });

  return recurringId;
}

async function seedOccurrence(
  db: Db,
  {
    owner,
    recurringId,
    date,
    status,
    workspaceId = owner.workspaceId,
  }: {
    owner: Owner;
    recurringId: string;
    date: Date;
    status: string;
    workspaceId?: string;
  },
): Promise<string> {
  const id = randomUUID();

  await db.insert(schema.transactions).values({
    id,
    workspaceId,
    accountId: owner.accountId,
    categoryId: owner.categoryId,
    recurringId,
    title: 'Rent',
    amount: 1000,
    date,
    type: 'EXPENSE',
    status,
  });

  return id;
}

async function findOccurrence(db: Db, id: string) {
  const [occurrence] = await db
    .select()
    .from(schema.transactions)
    .where(eq(schema.transactions.id, id));

  return occurrence;
}

async function findRule(db: Db, id: string) {
  const [rule] = await db
    .select()
    .from(schema.recurringTransactions)
    .where(eq(schema.recurringTransactions.id, id));

  return rule;
}

describe('recurring transaction delete', () => {
  let container: StartedPostgreSqlContainer;
  let queryClient: postgres.Sql;
  let moduleRef: TestingModule;
  let db: DrizzleService['db'];
  let repository: RecurringTransactionRepositoryImplementation;

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
        RecurringTransactionRepositoryImplementation,
      ],
    }).compile();

    db = moduleRef.get(DrizzleService).db;
    repository = moduleRef.get(RecurringTransactionRepositoryImplementation);
  });

  afterAll(async () => {
    await moduleRef?.close();
    await queryClient?.end({ timeout: 5 });
    await container?.stop();
  });

  beforeEach(async () => {
    await db.execute(
      sql`TRUNCATE workspaces, accounts, categories, recurring_transactions, transactions RESTART IDENTITY CASCADE`,
    );
  });

  describe('deleting the rule', () => {
    it('should delete future PENDING occurrences and the rule', async () => {
      const owner = await seedWorkspace(db);
      const recurringId = await seedRule(db, owner);
      const futurePendingId = await seedOccurrence(db, {
        owner,
        recurringId,
        date: NEXT_MONTH,
        status: 'PENDING',
      });

      await repository.deleteWithFuturePendingOccurrences(recurringId, {
        workspaceId: owner.workspaceId,
        timezone: TIMEZONE,
        todayStart: TODAY_START,
      });

      expect(await findOccurrence(db, futurePendingId)).toBeUndefined();
      expect(await findRule(db, recurringId)).toBeUndefined();
    });

    it('should keep past and today PENDING occurrences, orphaned', async () => {
      const owner = await seedWorkspace(db);
      const recurringId = await seedRule(db, owner);
      const pastPendingId = await seedOccurrence(db, {
        owner,
        recurringId,
        date: LAST_MONTH,
        status: 'PENDING',
      });
      const todayPendingId = await seedOccurrence(db, {
        owner,
        recurringId,
        date: TODAY,
        status: 'PENDING',
      });

      await repository.deleteWithFuturePendingOccurrences(recurringId, {
        workspaceId: owner.workspaceId,
        timezone: TIMEZONE,
        todayStart: TODAY_START,
      });

      expect((await findOccurrence(db, pastPendingId)).recurringId).toBeNull();
      expect((await findOccurrence(db, todayPendingId)).recurringId).toBeNull();
    });

    it('should keep a PENDING occurrence that is already tomorrow in UTC but still today in the account timezone', async () => {
      const owner = await seedWorkspace(db);
      const recurringId = await seedRule(db, owner);
      const utcTomorrowId = await seedOccurrence(db, {
        owner,
        recurringId,
        date: UTC_TOMORROW_TODAY_LOCAL,
        status: 'PENDING',
      });

      await repository.deleteWithFuturePendingOccurrences(recurringId, {
        workspaceId: owner.workspaceId,
        timezone: TIMEZONE,
        todayStart: TODAY_START,
      });

      expect((await findOccurrence(db, utcTomorrowId)).recurringId).toBeNull();
    });

    it('should delete a PENDING occurrence that is tomorrow in a timezone ahead of UTC while still today in UTC', async () => {
      const owner = await seedWorkspace(db);
      const recurringId = await seedRule(db, owner);
      const tokyoTomorrowId = await seedOccurrence(db, {
        owner,
        recurringId,
        date: UTC_TODAY_TOKYO_TOMORROW,
        status: 'PENDING',
      });

      await repository.deleteWithFuturePendingOccurrences(recurringId, {
        workspaceId: owner.workspaceId,
        timezone: TOKYO_TIMEZONE,
        todayStart: TOKYO_TODAY_START,
      });

      expect(await findOccurrence(db, tokyoTomorrowId)).toBeUndefined();
    });

    it('should keep a future COMPLETED occurrence, orphaned', async () => {
      const owner = await seedWorkspace(db);
      const recurringId = await seedRule(db, owner);
      const futureCompletedId = await seedOccurrence(db, {
        owner,
        recurringId,
        date: NEXT_MONTH,
        status: 'COMPLETED',
      });

      await repository.deleteWithFuturePendingOccurrences(recurringId, {
        workspaceId: owner.workspaceId,
        timezone: TIMEZONE,
        todayStart: TODAY_START,
      });

      expect(
        (await findOccurrence(db, futureCompletedId)).recurringId,
      ).toBeNull();
    });

    it('should mark the surviving occurrences as detached from the deleted rule', async () => {
      const owner = await seedWorkspace(db);
      const recurringId = await seedRule(db, owner);
      const pastPendingId = await seedOccurrence(db, {
        owner,
        recurringId,
        date: LAST_MONTH,
        status: 'PENDING',
      });
      const pastCompletedId = await seedOccurrence(db, {
        owner,
        recurringId,
        date: new Date('2026-01-15T03:00:00.000Z'),
        status: 'COMPLETED',
      });
      const futurePendingId = await seedOccurrence(db, {
        owner,
        recurringId,
        date: NEXT_MONTH,
        status: 'PENDING',
      });

      await repository.deleteWithFuturePendingOccurrences(recurringId, {
        workspaceId: owner.workspaceId,
        timezone: TIMEZONE,
        todayStart: TODAY_START,
      });

      const survivors = [
        await findOccurrence(db, pastPendingId),
        await findOccurrence(db, pastCompletedId),
      ];

      expect(await findOccurrence(db, futurePendingId)).toBeUndefined();
      expect(survivors.map((row) => row.recurringId)).toEqual([null, null]);
      expect(
        survivors.map((row) => row.recurringDetachedAt instanceof Date),
      ).toEqual([true, true]);
    });

    it('should leave the rule and its occurrences untouched when the workspace does not match', async () => {
      const owner = await seedWorkspace(db);
      const otherOwner = await seedWorkspace(db);
      const recurringId = await seedRule(db, owner);
      const pastCompletedId = await seedOccurrence(db, {
        owner,
        recurringId,
        date: LAST_MONTH,
        status: 'COMPLETED',
      });
      const futurePendingId = await seedOccurrence(db, {
        owner,
        recurringId,
        date: NEXT_MONTH,
        status: 'PENDING',
      });

      await repository.deleteWithFuturePendingOccurrences(recurringId, {
        workspaceId: otherOwner.workspaceId,
        timezone: TIMEZONE,
        todayStart: TODAY_START,
      });

      const pastCompleted = await findOccurrence(db, pastCompletedId);
      const futurePending = await findOccurrence(db, futurePendingId);

      expect(await findRule(db, recurringId)).toBeDefined();
      expect(pastCompleted.recurringId).toBe(recurringId);
      expect(pastCompleted.recurringDetachedAt).toBeNull();
      expect(futurePending.recurringId).toBe(recurringId);
    });

    it('should keep future occurrences of another rule', async () => {
      const owner = await seedWorkspace(db);
      const recurringId = await seedRule(db, owner);
      const otherRuleId = await seedRule(db, owner);
      const otherOccurrenceId = await seedOccurrence(db, {
        owner,
        recurringId: otherRuleId,
        date: NEXT_MONTH,
        status: 'PENDING',
      });

      await repository.deleteWithFuturePendingOccurrences(recurringId, {
        workspaceId: owner.workspaceId,
        timezone: TIMEZONE,
        todayStart: TODAY_START,
      });

      expect((await findOccurrence(db, otherOccurrenceId)).recurringId).toBe(
        otherRuleId,
      );
    });

    it('should not delete future occurrences recorded in another workspace', async () => {
      const owner = await seedWorkspace(db);
      const otherOwner = await seedWorkspace(db);
      const recurringId = await seedRule(db, owner);
      const foreignOccurrenceId = await seedOccurrence(db, {
        owner,
        recurringId,
        date: NEXT_MONTH,
        status: 'PENDING',
        workspaceId: otherOwner.workspaceId,
      });

      await repository.deleteWithFuturePendingOccurrences(recurringId, {
        workspaceId: owner.workspaceId,
        timezone: TIMEZONE,
        todayStart: TODAY_START,
      });

      const foreignOccurrence = await findOccurrence(db, foreignOccurrenceId);
      expect(foreignOccurrence).toBeDefined();
      expect(foreignOccurrence.recurringId).toBeNull();
    });
  });

  it('should have the drizzle FK name with set null on a fresh database', async () => {
    const rows = await queryClient`
      SELECT conname, confdeltype FROM pg_constraint
      WHERE conrelid = 'public.transactions'::regclass
        AND confrelid = 'public.recurring_transactions'::regclass`;

    expect(rows).toEqual([{ conname: DRIZZLE_FK_NAME, confdeltype: 'n' }]);
  });

  describe('database with the Prisma-era FK name', () => {
    let prodClient: postgres.Sql;
    let prodDb: Db;

    beforeAll(async () => {
      await queryClient`CREATE DATABASE prod_shaped`;
      const url = new URL(container.getConnectionUri());
      url.pathname = '/prod_shaped';
      prodClient = postgres(url.toString(), {
        max: 2,
        onnotice: () => undefined,
      });
      prodDb = drizzle(prodClient, { schema });
      await migrate(prodDb, {
        migrationsFolder: buildFolderUntil(LAST_PRISMA_ERA_MIGRATION_TAG),
      });
      await prodClient.unsafe(
        `ALTER TABLE transactions RENAME CONSTRAINT "${DRIZZLE_FK_NAME}" TO "${PRISMA_FK_NAME}"`,
      );
      await migrate(prodDb, { migrationsFolder: MIGRATIONS_FOLDER });
    });

    afterAll(async () => {
      await prodClient?.end({ timeout: 5 });
    });

    it('should end with the drizzle FK name and set null', async () => {
      const rows = await prodClient`
        SELECT conname, confdeltype FROM pg_constraint
        WHERE conrelid = 'public.transactions'::regclass
          AND confrelid = 'public.recurring_transactions'::regclass`;

      expect(rows).toEqual([{ conname: DRIZZLE_FK_NAME, confdeltype: 'n' }]);
    });

    it('should null the link when the rule is deleted', async () => {
      const owner = await seedWorkspace(prodDb);
      const recurringId = await seedRule(prodDb, owner);
      const occurrenceId = await seedOccurrence(prodDb, {
        owner,
        recurringId,
        date: LAST_MONTH,
        status: 'COMPLETED',
      });

      await prodDb
        .delete(schema.recurringTransactions)
        .where(eq(schema.recurringTransactions.id, recurringId));

      expect(
        (await findOccurrence(prodDb, occurrenceId)).recurringId,
      ).toBeNull();
    });
  });
});
