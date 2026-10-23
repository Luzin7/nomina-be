import { RecurringKind, TransactionType } from '@constants/enums';
import { DrizzleService } from '@infra/databases/drizzle/drizzle.service';
import * as schema from '@infra/databases/drizzle/schema';
import {
  PostgreSqlContainer,
  StartedPostgreSqlContainer,
} from '@testcontainers/postgresql';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import postgres from 'postgres';
import { RecurringTransactionRepositoryImplementation } from './recurring-transaction.repository';

type RecurringRow = typeof schema.recurringTransactions.$inferInsert;

const MIGRATIONS_FOLDER = resolve(__dirname, '../../../../../drizzle');
const PAGE = { page: 1, pageSize: 20 };

jest.setTimeout(180_000);

describe('recurring list kind filter against a real postgres', () => {
  let container: StartedPostgreSqlContainer;
  let queryClient: postgres.Sql;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  let repository: RecurringTransactionRepositoryImplementation;

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
    repository = new RecurringTransactionRepositoryImplementation({
      db,
    } as unknown as DrizzleService);
  });

  afterAll(async () => {
    await queryClient?.end({ timeout: 5 });
    await container?.stop();
  });

  function makeRow(
    overrides: Partial<RecurringRow> &
      Pick<RecurringRow, 'workspaceId' | 'accountId' | 'categoryId'>,
  ): RecurringRow {
    return {
      id: randomUUID(),
      title: 'Recurring',
      amount: 1_000,
      type: TransactionType.EXPENSE,
      frequency: 'MONTHLY',
      startDate: new Date('2099-01-15T12:00:00Z'),
      ...overrides,
    };
  }

  async function seedWorkspaceWithRows() {
    const workspaceId = randomUUID();
    const accountId = randomUUID();
    const categoryId = randomUUID();
    await db.insert(schema.workspaces).values({ id: workspaceId, name: 'WS' });
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
      type: TransactionType.EXPENSE,
    });

    const base = { workspaceId, accountId, categoryId };
    const plan = makeRow({ ...base, installmentCount: 6 });
    const twoInstallments = makeRow({ ...base, installmentCount: 2 });
    const oneInstallment = makeRow({ ...base, installmentCount: 1 });
    const subscription = makeRow({ ...base, installmentCount: null });
    await db
      .insert(schema.recurringTransactions)
      .values([plan, twoInstallments, oneInstallment, subscription]);

    return {
      workspaceId,
      plan: plan.id,
      twoInstallments: twoInstallments.id,
      oneInstallment: oneInstallment.id,
      subscription: subscription.id,
    };
  }

  it('should list only installment plans of two or more for kind installment', async () => {
    const seeded = await seedWorkspaceWithRows();

    const result = await repository.findManyByWorkspaceId({
      workspaceId: seeded.workspaceId,
      kind: RecurringKind.INSTALLMENT,
      ...PAGE,
    });

    expect(result.recurrings.map((item) => item.id).sort()).toEqual(
      [seeded.plan, seeded.twoInstallments].sort(),
    );
    expect(result.total).toBe(2);
  });

  it('should list null counts and single installments for kind recurring', async () => {
    const seeded = await seedWorkspaceWithRows();

    const result = await repository.findManyByWorkspaceId({
      workspaceId: seeded.workspaceId,
      kind: RecurringKind.RECURRING,
      ...PAGE,
    });

    expect(result.recurrings.map((item) => item.id).sort()).toEqual(
      [seeded.oneInstallment, seeded.subscription].sort(),
    );
    expect(result.total).toBe(2);
  });

  it('should list everything when kind is absent', async () => {
    const seeded = await seedWorkspaceWithRows();

    const result = await repository.findManyByWorkspaceId({
      workspaceId: seeded.workspaceId,
      ...PAGE,
    });

    expect(result.total).toBe(4);
  });

  it('should count the filtered rows rather than the page', async () => {
    const seeded = await seedWorkspaceWithRows();

    const result = await repository.findManyByWorkspaceId({
      workspaceId: seeded.workspaceId,
      kind: RecurringKind.INSTALLMENT,
      page: 1,
      pageSize: 1,
    });

    expect(result.recurrings).toHaveLength(1);
    expect(result.total).toBe(2);
  });
});
