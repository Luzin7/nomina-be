import { TransactionStatus, TransactionType } from '@constants/enums';
import { REIMBURSEMENTS_CATEGORY_NAME } from '@constants/incomeCategories';
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
import { BudgetRepositoryImplementation } from './budget.repository';

type Database = ReturnType<typeof drizzle<typeof schema>>;

const MIGRATIONS_FOLDER = resolve(__dirname, '../../../../../drizzle');
const FEBRUARY_DAY = new Date('2026-02-10T12:00:00.000Z');

jest.setTimeout(180_000);

describe('budget inference totals against a real postgres', () => {
  let container: StartedPostgreSqlContainer;
  let queryClient: postgres.Sql;
  let db: Database;
  let repository: BudgetRepositoryImplementation;
  let workspaceId: string;
  let accountId: string;
  let expenseCategoryId: string;

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:16-alpine')
      .withStartupTimeout(120_000)
      .start();

    queryClient = postgres(container.getConnectionUri(), {
      max: 5,
      onnotice: () => undefined,
      connection: { TimeZone: 'UTC' },
    });
    db = drizzle(queryClient, { schema });

    await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });

    repository = new BudgetRepositoryImplementation(new DrizzleService(db));
  });

  afterAll(async () => {
    await queryClient.end({ timeout: 5 });
    await container.stop();
  });

  beforeEach(async () => {
    await db.execute(sql`TRUNCATE workspaces RESTART IDENTITY CASCADE`);

    workspaceId = randomUUID();
    accountId = randomUUID();
    expenseCategoryId = randomUUID();

    await db.insert(schema.workspaces).values({ id: workspaceId, name: 'WS' });
    await db.insert(schema.accounts).values({
      id: accountId,
      workspaceId,
      name: 'Conta',
      type: 'CHECKING',
    });
    await db.insert(schema.categories).values([
      {
        id: expenseCategoryId,
        workspaceId,
        name: 'Moradia',
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
  });

  async function insertCategory(
    name: string,
    parentId: string | null = null,
  ): Promise<string> {
    const id = randomUUID();
    await db.insert(schema.categories).values({
      id,
      workspaceId,
      name,
      type: TransactionType.INCOME,
      parentId,
    });
    return id;
  }

  async function insertRecurring(categoryId: string): Promise<string> {
    const id = randomUUID();
    await db.insert(schema.recurringTransactions).values({
      id,
      workspaceId,
      accountId,
      categoryId,
      type: TransactionType.INCOME,
      title: 'Recorrente',
      amount: 1,
      frequency: 'MONTHLY',
      startDate: FEBRUARY_DAY,
    });
    return id;
  }

  async function insertTransaction(
    overrides: Partial<typeof schema.transactions.$inferInsert>,
  ) {
    await db.insert(schema.transactions).values({
      id: randomUUID(),
      workspaceId,
      accountId,
      categoryId: expenseCategoryId,
      title: 'Linha',
      amount: 10_000,
      date: FEBRUARY_DAY,
      type: TransactionType.EXPENSE,
      status: TransactionStatus.COMPLETED,
      ...overrides,
    });
  }

  const income = (categoryId: string, amount: number, recurringId?: string) =>
    insertTransaction({
      categoryId,
      amount,
      type: TransactionType.INCOME,
      recurringId,
    });

  it('sums only real income and keeps the expense side untouched', async () => {
    const salary = await insertCategory('Salário');
    const freela = await insertCategory('Freela/Projeto');
    const freelaChild = await insertCategory('Consultoria', freela);
    const others = await insertCategory('Outros');
    const gift = await insertCategory('Presente');
    const investments = await insertCategory('Investimentos');
    const redemption = await insertCategory('Resgate', investments);
    const yieldChild = await insertCategory('Rendimento CDB', investments);
    const customRoot = await insertCategory('Aluguel recebido');
    const systemRoot = randomUUID();
    await db.insert(schema.categories).values({
      id: systemRoot,
      workspaceId,
      name: 'Sistema recorrente',
      type: TransactionType.INCOME,
      isSystemCategory: true,
    });

    await income(salary, 500_000);
    await income(freelaChild, 70_000);
    await income(others, 80_000);
    await income(redemption, 300_000);
    await income(redemption, 300_000, await insertRecurring(redemption));
    await income(yieldChild, 20_000);
    await income(gift, 30_000);
    await income(customRoot, 120_000, await insertRecurring(customRoot));
    await income(systemRoot, 150_000, await insertRecurring(systemRoot));
    await insertTransaction({
      amount: 200_000,
      categoryId: SYSTEM_CATEGORY.TRANSFER.id,
      type: TransactionType.TRANSFER,
    });
    await insertTransaction({
      amount: 90_000,
      categoryId: SYSTEM_CATEGORY.CREDIT_CARD_PAYMENT.id,
    });
    await insertTransaction({ amount: 10_000 });

    const totals = await repository.findInferenceTotals({
      workspaceId,
      start: new Date('2026-01-01T00:00:00.000Z'),
      end: new Date('2026-03-31T23:59:59.999Z'),
      timezone: 'UTC',
    });

    expect(totals).toEqual([
      {
        month: '2026-02',
        incomeCents: 710_000,
        expenseByCategory: { [expenseCategoryId]: 10_000 },
      },
    ]);
  });

  it('keeps reimbursements out of the income base', async () => {
    const salary = await insertCategory('Salário');
    const reimbursements = await insertCategory(REIMBURSEMENTS_CATEGORY_NAME);

    await income(salary, 500_000);
    await income(reimbursements, 80_000);
    await insertTransaction({ amount: 80_000 });

    const totals = await repository.findInferenceTotals({
      workspaceId,
      start: new Date('2026-01-01T00:00:00.000Z'),
      end: new Date('2026-03-31T23:59:59.999Z'),
      timezone: 'UTC',
    });

    expect(totals).toEqual([
      {
        month: '2026-02',
        incomeCents: 500_000,
        expenseByCategory: { [expenseCategoryId]: 80_000 },
      },
    ]);
  });

  it('keeps recurring reimbursements out of the income base', async () => {
    const salary = await insertCategory('Salário');
    const reimbursements = await insertCategory(REIMBURSEMENTS_CATEGORY_NAME);

    await income(salary, 500_000);
    await income(reimbursements, 80_000, await insertRecurring(reimbursements));
    await insertTransaction({ amount: 80_000 });

    const totals = await repository.findInferenceTotals({
      workspaceId,
      start: new Date('2026-01-01T00:00:00.000Z'),
      end: new Date('2026-03-31T23:59:59.999Z'),
      timezone: 'UTC',
    });

    expect(totals).toEqual([
      {
        month: '2026-02',
        incomeCents: 500_000,
        expenseByCategory: { [expenseCategoryId]: 80_000 },
      },
    ]);
  });

  it('ignores income that is not completed', async () => {
    const salary = await insertCategory('Salário');
    await insertTransaction({
      categoryId: salary,
      amount: 500_000,
      type: TransactionType.INCOME,
      status: TransactionStatus.PENDING,
    });

    const totals = await repository.findInferenceTotals({
      workspaceId,
      start: new Date('2026-01-01T00:00:00.000Z'),
      end: new Date('2026-03-31T23:59:59.999Z'),
      timezone: 'UTC',
    });

    expect(totals).toEqual([]);
  });
});
