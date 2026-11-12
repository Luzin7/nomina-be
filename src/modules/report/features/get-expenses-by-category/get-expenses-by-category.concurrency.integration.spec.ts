import {
  AccountType,
  TransactionStatus,
  TransactionType,
} from '@constants/enums';
import { DrizzleService } from '@infra/databases/drizzle/drizzle.service';
import { TransactionRepositoryImplementation } from '@infra/databases/drizzle/repositories/transaction.repository';
import * as schema from '@infra/databases/drizzle/schema';
import { GetWorkspaceTimezoneService } from '@modules/workspace/services/get-workspace-timezone.service';
import { DayJsDateProvider } from '@providers/date/implementations/Dayjs';
import {
  PostgreSqlContainer,
  StartedPostgreSqlContainer,
} from '@testcontainers/postgresql';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import postgres from 'postgres';
import { CacheProvider } from '@infra/cache/contracts/CacheProvider';
import { GetExpensesByCategoryService } from './get-expenses-by-category.handler';

type CategoryRow = typeof schema.categories.$inferInsert;
type TransactionRow = typeof schema.transactions.$inferInsert;
type CategoryFixture = CategoryRow & { id: string };

const MIGRATIONS_FOLDER = resolve(__dirname, '../../../../../drizzle');
const NOW = new Date('2026-11-10T12:00:00.000Z');
const PREVIOUS_MONTH = { month: 10, year: 2026 };
const CURRENT_MONTH = { month: 11, year: 2026 };

jest.setTimeout(180_000);

function makeExpenseCategory(overrides: Partial<CategoryRow>): CategoryFixture {
  return {
    id: randomUUID(),
    name: 'Mercado',
    type: TransactionType.EXPENSE,
    ...overrides,
  };
}

function makeExpense(
  overrides: Partial<TransactionRow> &
    Pick<TransactionRow, 'workspaceId' | 'accountId' | 'categoryId'>,
): TransactionRow {
  return {
    id: randomUUID(),
    title: 'Expense',
    amount: 1_000,
    date: new Date('2026-11-05T12:00:00.000Z'),
    type: TransactionType.EXPENSE,
    status: TransactionStatus.COMPLETED,
    ...overrides,
  };
}

describe('expenses by category over a hidden category', () => {
  let container: StartedPostgreSqlContainer;
  let queryClient: postgres.Sql;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  let service: GetExpensesByCategoryService;
  let workspaceId: string;
  let hiddenCategoryName: string;

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:16-alpine')
      .withStartupTimeout(120_000)
      .start();
    queryClient = postgres(container.getConnectionUri(), {
      max: 1,
      onnotice: () => undefined,
      connection: { TimeZone: 'UTC' },
    });
    db = drizzle(queryClient, { schema });
    await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });

    const dateProvider = new DayJsDateProvider();
    jest.spyOn(dateProvider, 'now').mockReturnValue(NOW);

    service = new GetExpensesByCategoryService(
      new TransactionRepositoryImplementation({
        db,
      } as unknown as DrizzleService),
      {
        execute: jest.fn().mockResolvedValue('UTC'),
      } as unknown as GetWorkspaceTimezoneService,
      dateProvider,
      {
        get: jest.fn().mockResolvedValue(null),
        set: jest.fn().mockResolvedValue(true),
        readCounter: jest.fn().mockResolvedValue(null),
      } as unknown as CacheProvider,
    );
  });

  afterAll(async () => {
    await queryClient?.end({ timeout: 5 });
    await container?.stop();
  });

  beforeEach(async () => {
    await db.execute(
      sql`TRUNCATE workspaces, accounts, categories, transactions RESTART IDENTITY CASCADE`,
    );

    workspaceId = randomUUID();
    const accountId = randomUUID();
    const visible = makeExpenseCategory({ workspaceId, name: 'Mercado' });
    const hidden = makeExpenseCategory({
      workspaceId,
      name: 'Petshop',
      isHidden: true,
    });
    hiddenCategoryName = hidden.name;

    await db.insert(schema.workspaces).values({ id: workspaceId, name: 'WS' });
    await db.insert(schema.accounts).values({
      id: accountId,
      workspaceId,
      name: 'Conta',
      type: AccountType.CHECKING,
    });
    await db.insert(schema.categories).values([visible, hidden]);
    await db.insert(schema.transactions).values([
      makeExpense({ workspaceId, accountId, categoryId: visible.id }),
      makeExpense({
        workspaceId,
        accountId,
        categoryId: hidden.id,
        amount: 600,
      }),
      makeExpense({
        workspaceId,
        accountId,
        categoryId: visible.id,
        amount: 2_000,
        date: new Date('2026-10-05T12:00:00.000Z'),
      }),
      makeExpense({
        workspaceId,
        accountId,
        categoryId: hidden.id,
        amount: 700,
        date: new Date('2026-10-05T12:00:00.000Z'),
      }),
    ]);
  });

  it('excludes the hidden category from the current month', async () => {
    const result = await service.execute({ workspaceId, ...CURRENT_MONTH });

    expect(result.expenses.map((expense) => expense.categoryName)).toEqual([
      'Mercado',
    ]);
  });

  it('keeps the hidden category in a historical month', async () => {
    const result = await service.execute({ workspaceId, ...PREVIOUS_MONTH });

    expect(result.expenses.map((expense) => expense.categoryName)).toEqual([
      'Mercado',
      hiddenCategoryName,
    ]);
  });
});
