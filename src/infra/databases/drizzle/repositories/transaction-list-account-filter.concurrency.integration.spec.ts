import {
  AccountType,
  TransactionStatus,
  TransactionType,
} from '@constants/enums';
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
import { TransactionRepositoryImplementation } from './transaction.repository';

type TransactionRow = typeof schema.transactions.$inferInsert;

const MIGRATIONS_FOLDER = resolve(__dirname, '../../../../../drizzle');
const PAGE = { page: 1, pageSize: 20 };

jest.setTimeout(180_000);

describe('transaction list account filter against a real postgres', () => {
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
    await queryClient?.end({ timeout: 5 });
    await container?.stop();
  });

  async function seedWorkspace() {
    const workspaceId = randomUUID();
    const categoryId = randomUUID();
    const [source, destination, other] = [
      randomUUID(),
      randomUUID(),
      randomUUID(),
    ];

    await db.insert(schema.workspaces).values({ id: workspaceId, name: 'WS' });
    await db.insert(schema.accounts).values(
      [source, destination, other].map((id) => ({
        id,
        workspaceId,
        name: id,
        type: AccountType.CHECKING,
      })),
    );
    await db.insert(schema.categories).values({
      id: categoryId,
      workspaceId,
      name: 'Category',
      type: TransactionType.EXPENSE,
    });

    return { workspaceId, categoryId, source, destination, other };
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

  it('should list an incoming transfer under the destination account filter', async () => {
    const { workspaceId, categoryId, source, destination } =
      await seedWorkspace();
    const transfer = makeRow({
      workspaceId,
      categoryId,
      accountId: source,
      destinationAccountId: destination,
      type: TransactionType.TRANSFER,
    });
    await db.insert(schema.transactions).values(transfer);

    const result = await repository.listTransactionsByWorkspaceId({
      workspaceId,
      accountId: destination,
      ...PAGE,
    });

    expect(result.transactions.map((item) => item.id)).toEqual([transfer.id]);
    expect(result.total).toBe(1);
  });

  it('should not list transactions of other accounts', async () => {
    const { workspaceId, categoryId, source, destination, other } =
      await seedWorkspace();
    await db.insert(schema.transactions).values([
      makeRow({
        workspaceId,
        categoryId,
        accountId: source,
        destinationAccountId: destination,
        type: TransactionType.TRANSFER,
      }),
      makeRow({ workspaceId, categoryId, accountId: source }),
    ]);

    const result = await repository.listTransactionsByWorkspaceId({
      workspaceId,
      accountId: other,
      ...PAGE,
    });

    expect(result.transactions).toEqual([]);
    expect(result.total).toBe(0);
  });

  it('should not list a transaction from another workspace that points at the same destination account', async () => {
    const { workspaceId, categoryId, source, destination } =
      await seedWorkspace();
    const foreign = await seedWorkspace();
    await db.insert(schema.transactions).values(
      makeRow({
        workspaceId: foreign.workspaceId,
        categoryId: foreign.categoryId,
        accountId: foreign.source,
        destinationAccountId: destination,
        type: TransactionType.TRANSFER,
      }),
    );
    const own = makeRow({
      workspaceId,
      categoryId,
      accountId: source,
      destinationAccountId: destination,
      type: TransactionType.TRANSFER,
    });
    await db.insert(schema.transactions).values(own);

    const result = await repository.listTransactionsByWorkspaceId({
      workspaceId,
      accountId: destination,
      ...PAGE,
    });

    expect(result.transactions.map((item) => item.id)).toEqual([own.id]);
    expect(result.total).toBe(1);
  });
});
