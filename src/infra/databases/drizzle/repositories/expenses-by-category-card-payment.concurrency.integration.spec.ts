import {
  AccountType,
  TransactionStatus,
  TransactionType,
} from '@constants/enums';
import { DrizzleService } from '@infra/databases/drizzle/drizzle.service';
import * as schema from '@infra/databases/drizzle/schema';
import { SYSTEM_CATEGORY } from '@modules/category/constants/system-categories';
import {
  PostgreSqlContainer,
  StartedPostgreSqlContainer,
} from '@testcontainers/postgresql';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import postgres from 'postgres';
import { TransactionRepositoryImplementation } from './transaction.repository';

type Database = ReturnType<typeof drizzle<typeof schema>>;
type TransactionRow = typeof schema.transactions.$inferInsert;

const MIGRATIONS_FOLDER = resolve(__dirname, '../../../../../drizzle');
const PERIOD = {
  startDate: new Date('2026-09-01T03:00:00.000Z'),
  endDate: new Date('2026-10-01T02:59:59.999Z'),
};

jest.setTimeout(180_000);

describe('expenses by category card bill payment against a real postgres', () => {
  let container: StartedPostgreSqlContainer;
  let queryClient: postgres.Sql;
  let db: Database;
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

    repository = new TransactionRepositoryImplementation(
      new DrizzleService(db),
    );
  });

  afterAll(async () => {
    await queryClient?.end({ timeout: 5 });
    await container?.stop();
  });

  beforeEach(async () => {
    await db.execute(sql`TRUNCATE workspaces RESTART IDENTITY CASCADE`);
  });

  async function seed() {
    const workspaceId = randomUUID();
    const sourceAccountId = randomUUID();
    const cardAccountId = randomUUID();
    const expenseCategoryId = randomUUID();

    await db.insert(schema.workspaces).values({ id: workspaceId, name: 'WS' });
    await db.insert(schema.accounts).values([
      {
        id: sourceAccountId,
        workspaceId,
        name: 'Conta',
        type: AccountType.CHECKING,
      },
      {
        id: cardAccountId,
        workspaceId,
        name: 'Cartão',
        type: AccountType.CREDIT_CARD,
        creditLimit: 500_000,
        dueDay: 15,
      },
    ]);
    await db.insert(schema.categories).values([
      {
        id: expenseCategoryId,
        workspaceId,
        name: 'Mercado',
        type: TransactionType.EXPENSE,
      },
      ...Object.values(SYSTEM_CATEGORY).map((category) => ({
        id: category.id,
        workspaceId: null,
        name: category.name,
        type: category.type,
        isSystemCategory: true,
      })),
    ]);

    const expense: TransactionRow = {
      workspaceId,
      accountId: sourceAccountId,
      categoryId: expenseCategoryId,
      title: 'Mercado',
      amount: 10_000,
      date: new Date('2026-09-10T12:00:00.000Z'),
      type: TransactionType.EXPENSE,
      status: TransactionStatus.COMPLETED,
    };
    const cardBillPayment: TransactionRow = {
      workspaceId,
      accountId: sourceAccountId,
      destinationAccountId: cardAccountId,
      categoryId: SYSTEM_CATEGORY.CREDIT_CARD_PAYMENT.id,
      title: 'Pagamento de Fatura Cartão',
      amount: 90_000,
      date: new Date('2026-09-12T12:00:00.000Z'),
      type: TransactionType.TRANSFER,
      status: TransactionStatus.COMPLETED,
    };
    await db.insert(schema.transactions).values([expense, cardBillPayment]);

    return { workspaceId, expenseCategoryId };
  }

  it('should not count a card bill payment as an expense', async () => {
    const { workspaceId, expenseCategoryId } = await seed();

    const result = await repository.getTopExpensesByCategory({
      workspaceId,
      ...PERIOD,
      pageSize: 5,
      isCurrentMonth: false,
    });

    expect(result.totalExpense).toBe(10_000);
    expect(result.expenses).toEqual([
      expect.objectContaining({
        categoryId: expenseCategoryId,
        amount: 10_000,
      }),
    ]);
  });
});
