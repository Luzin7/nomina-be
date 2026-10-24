import {
  AccountType,
  TransactionStatus,
  TransactionType,
} from '@constants/enums';
import { DrizzleService } from '@infra/databases/drizzle/drizzle.service';
import * as schema from '@infra/databases/drizzle/schema';
import { TransactionPreviewPresenter } from '@modules/transaction/presenters/TransactionPreview.presenter';
import {
  PostgreSqlContainer,
  StartedPostgreSqlContainer,
} from '@testcontainers/postgresql';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import postgres from 'postgres';
import { TransactionRepositoryImplementation } from './transaction.repository';

type TransactionRow = typeof schema.transactions.$inferInsert;

const MIGRATIONS_FOLDER = resolve(__dirname, '../../../../../drizzle');
const PAGE = { page: 1, pageSize: 20 };

jest.setTimeout(180_000);

describe('transaction list preview fields against a real postgres', () => {
  let container: StartedPostgreSqlContainer;
  let queryClient: postgres.Sql;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  let repository: TransactionRepositoryImplementation;

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
    repository = new TransactionRepositoryImplementation({
      db,
    } as unknown as DrizzleService);
  });

  afterAll(async () => {
    await queryClient.end({ timeout: 5 });
    await container.stop();
  });

  async function seedWorkspace() {
    const workspaceId = randomUUID();
    const categoryId = randomUUID();
    const accountId = randomUUID();

    await db.insert(schema.workspaces).values({ id: workspaceId, name: 'WS' });
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

    return { workspaceId, categoryId, accountId };
  }

  function makeRow(
    overrides: Partial<TransactionRow> &
      Pick<TransactionRow, 'workspaceId' | 'accountId' | 'categoryId'>,
  ): TransactionRow {
    return {
      id: randomUUID(),
      title: 'Transaction',
      amount: 1_000,
      date: new Date('2024-01-20T12:00:00Z'),
      type: TransactionType.EXPENSE,
      status: TransactionStatus.COMPLETED,
      ...overrides,
    };
  }

  async function listPresented(workspaceId: string) {
    const { transactions } = await repository.listTransactionsByWorkspaceId({
      workspaceId,
      ...PAGE,
    });

    return transactions.map((item) => TransactionPreviewPresenter.toHTTP(item));
  }

  it('should list the description and the installment position of an installment purchase', async () => {
    const { workspaceId, categoryId, accountId } = await seedWorkspace();
    const row = makeRow({
      workspaceId,
      categoryId,
      accountId,
      description: 'Notebook novo',
      installmentGroupId: randomUUID(),
      installmentNumber: 3,
      installmentCount: 10,
    });
    await db.insert(schema.transactions).values(row);

    const [item] = await listPresented(workspaceId);

    expect(item).toMatchObject({
      id: row.id,
      description: 'Notebook novo',
      installmentNumber: 3,
      installmentCount: 10,
      recurringId: null,
    });
  });

  it('should list null optional fields for a plain transaction', async () => {
    const { workspaceId, categoryId, accountId } = await seedWorkspace();
    await db
      .insert(schema.transactions)
      .values(makeRow({ workspaceId, categoryId, accountId }));

    const [item] = await listPresented(workspaceId);

    expect(item).toMatchObject({
      description: null,
      installmentNumber: null,
      installmentCount: null,
      recurringId: null,
    });
  });

  it('should list the recurring id of a generated recurring transaction', async () => {
    const { workspaceId, categoryId, accountId } = await seedWorkspace();
    const recurringId = randomUUID();
    await db.insert(schema.recurringTransactions).values({
      id: recurringId,
      workspaceId,
      accountId,
      categoryId,
      title: 'Aluguel',
      amount: 1_000,
      type: TransactionType.EXPENSE,
      frequency: 'MONTHLY',
      startDate: new Date('2024-01-01T00:00:00Z'),
    } as typeof schema.recurringTransactions.$inferInsert);
    await db
      .insert(schema.transactions)
      .values(makeRow({ workspaceId, categoryId, accountId, recurringId }));

    const [item] = await listPresented(workspaceId);

    expect(item.recurringId).toBe(recurringId);
  });
});
