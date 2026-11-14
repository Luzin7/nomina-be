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
import { resolve } from 'node:path';
import postgres from 'postgres';
import { RecurringTransactionRepositoryImplementation } from './recurring-transaction.repository';

jest.mock('@sentry/nestjs', () => ({ captureException: jest.fn() }));

const MIGRATIONS_FOLDER = resolve(__dirname, '../../../../../drizzle');

jest.setTimeout(180_000);

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

  async function seedRuleWithTransaction() {
    const workspaceId = randomUUID();
    const accountId = randomUUID();
    const categoryId = randomUUID();
    const recurringId = randomUUID();
    const transactionId = randomUUID();

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
    await db.insert(schema.recurringTransactions).values({
      id: recurringId,
      workspaceId,
      accountId,
      categoryId,
      type: 'EXPENSE',
      title: 'Rent',
      amount: 1000,
      frequency: 'MONTHLY',
      startDate: new Date('2026-01-01T00:00:00Z'),
    });
    await db.insert(schema.transactions).values({
      id: transactionId,
      workspaceId,
      accountId,
      categoryId,
      recurringId,
      title: 'Rent',
      amount: 1000,
      date: new Date('2026-01-01T00:00:00Z'),
      type: 'EXPENSE',
      status: 'PAID',
    });

    return { recurringId, transactionId };
  }

  it('should keep linked transactions and null their recurring id', async () => {
    const { recurringId, transactionId } = await seedRuleWithTransaction();

    await repository.delete(recurringId);

    const [transaction] = await db
      .select()
      .from(schema.transactions)
      .where(eq(schema.transactions.id, transactionId));
    expect(transaction.recurringId).toBeNull();
  });
});
