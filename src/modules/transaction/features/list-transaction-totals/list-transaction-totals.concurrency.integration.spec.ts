import { TransactionStatus, TransactionType } from '@constants/enums';
import * as schema from '@infra/databases/drizzle/schema';
import { AccountRepository } from '@modules/account/repositories/contracts/AccountRepository';
import { makeCheckingAccount } from '@modules/account/test-helpers/mock-factories';
import { Category } from '@modules/category/entities/Category';
import { CategoryRepository } from '@modules/category/repositories/contracts/CategoryRepository';
import { ListTransactionsService } from '@modules/transaction/features/list-transaction/list-transaction.service';
import { Workspace } from '@modules/workspace/entities/Workspace';
import { WorkspaceRepository } from '@modules/workspace/repositories/contracts/WorkspaceRepository';
import {
  ApplicationHandle,
  createApplication,
  PostgresHandle,
  startPostgres,
} from '@shared/cache/test-helpers/freshness-harness';
import { InMemoryCacheProvider } from '@shared/cache/test-helpers/in-memory-cache';
import { randomUUID } from 'node:crypto';
import { ListTransactionTotalsService } from './list-transaction-totals.service';

jest.setTimeout(180_000);

function unwrap<T>(result: { isLeft(): boolean; value: unknown }): T {
  if (result.isLeft()) throw result.value;
  return result.value as T;
}

type Seed = Awaited<ReturnType<typeof seedWorkspace>>;

let postgres: PostgresHandle;
let app: ApplicationHandle;

async function seedWorkspace(timezone: string) {
  const workspaceId = randomUUID();
  const userId = randomUUID();
  const accountId = randomUUID();
  const destinationAccountId = randomUUID();
  const categoryId = randomUUID();
  await postgres.db.insert(schema.users).values({
    id: userId,
    email: `${userId}@example.com`,
    passwordHash: 'hash',
    name: 'Totals',
  });
  await app
    .get(WorkspaceRepository)
    .create(
      unwrap<Workspace>(
        Workspace.create({ name: 'Totals', timezone }, workspaceId),
      ),
    );
  for (const id of [accountId, destinationAccountId]) {
    await app
      .get(AccountRepository)
      .create(
        makeCheckingAccount({ id, workspaceId, name: `Conta ${id}`, timezone }),
      );
  }
  await app.get(CategoryRepository).create(
    unwrap<Category>(
      Category.create(
        {
          workspaceId,
          name: 'Mercado',
          type: TransactionType.EXPENSE,
          parentId: null,
          isSystemCategory: false,
        },
        categoryId,
      ),
    ),
  );

  return { workspaceId, userId, accountId, destinationAccountId, categoryId };
}

async function insertTransaction(
  seed: Seed,
  overrides: Partial<typeof schema.transactions.$inferInsert>,
) {
  await postgres.db.insert(schema.transactions).values({
    workspaceId: seed.workspaceId,
    accountId: seed.accountId,
    categoryId: seed.categoryId,
    title: 'Movimento',
    amount: 1_000,
    date: new Date('2026-02-10T15:00:00.000Z'),
    type: TransactionType.EXPENSE,
    status: TransactionStatus.COMPLETED,
    ...overrides,
  });
}

async function readAllPages(seed: Seed, filters: Record<string, unknown>) {
  const listService = app.get(ListTransactionsService);
  const rows: { type: string; amount: bigint | number }[] = [];
  let total = 0;
  for (let page = 1; ; page++) {
    const { transactions, total: pageTotal } = unwrap<{
      transactions: { type: string; amount: bigint | number }[];
      total: number;
    }>(
      await listService.execute({
        workspaceId: seed.workspaceId,
        sub: seed.userId,
        page,
        pageSize: 2,
        ...filters,
      } as never),
    );
    total = pageTotal;
    rows.push(...transactions);
    if (transactions.length === 0 || rows.length >= pageTotal) break;
  }

  const sumOf = (type: string) =>
    rows
      .filter((row) => row.type === type)
      .reduce((sum, row) => sum + Number(row.amount), 0);

  return {
    count: total,
    incomeCents: sumOf(TransactionType.INCOME),
    expenseCents: sumOf(TransactionType.EXPENSE),
    transferCents: sumOf(TransactionType.TRANSFER),
  };
}

const readTotals = async (seed: Seed, filters: Record<string, unknown> = {}) =>
  unwrap<Record<string, number>>(
    await app.get(ListTransactionTotalsService).execute({
      workspaceId: seed.workspaceId,
      sub: seed.userId,
      ...filters,
    } as never),
  );

describe('list totals against a real database', () => {
  beforeAll(async () => {
    postgres = await startPostgres();
    app = await createApplication(postgres.db, new InMemoryCacheProvider());
  });

  afterAll(async () => {
    await app?.close();
    await postgres?.stop();
  });

  it('equals the sums over every page of the list for the same filters', async () => {
    const seed = await seedWorkspace('UTC');
    await insertTransaction(seed, { amount: 1_500 });
    await insertTransaction(seed, { amount: 2_500 });
    await insertTransaction(seed, { amount: 700 });
    await insertTransaction(seed, {
      amount: 9_000,
      type: TransactionType.INCOME,
    });
    await insertTransaction(seed, {
      amount: 300,
      status: TransactionStatus.PENDING,
    });
    await insertTransaction(seed, {
      amount: 111,
      date: new Date('2026-03-20T15:00:00.000Z'),
    });
    const filters = { startDate: '2026-02-01', endDate: '2026-02-28' };

    const totals = await readTotals(seed, filters);

    expect(totals).toEqual(await readAllPages(seed, filters));
    expect(totals).toEqual({
      count: 5,
      incomeCents: 9_000,
      expenseCents: 5_000,
      transferCents: 0,
    });
  });

  it('puts a transfer only in transferCents', async () => {
    const seed = await seedWorkspace('UTC');
    await insertTransaction(seed, {
      amount: 4_000,
      type: TransactionType.TRANSFER,
      destinationAccountId: seed.destinationAccountId,
    });

    const totals = await readTotals(seed);

    expect(totals).toEqual({
      count: 1,
      incomeCents: 0,
      expenseCents: 0,
      transferCents: 4_000,
    });
  });

  it('returns the zero state when nothing matches', async () => {
    const seed = await seedWorkspace('UTC');

    expect(await readTotals(seed)).toEqual({
      count: 0,
      incomeCents: 0,
      expenseCents: 0,
      transferCents: 0,
    });
  });

  it.each([
    ['UTC', '2026-02-15T23:30:00.000Z', '2026-02-16T00:30:00.000Z'],
    [
      'America/Sao_Paulo',
      '2026-02-16T02:30:00.000Z',
      '2026-02-16T03:30:00.000Z',
    ],
  ])(
    'includes 23:30 local on the 15th and excludes the 16th for endDate on the 15th in %s',
    async (timezone, inside, outside) => {
      const seed = await seedWorkspace(timezone);
      await insertTransaction(seed, { amount: 100, date: new Date(inside) });
      await insertTransaction(seed, { amount: 900, date: new Date(outside) });
      const filters = { endDate: '2026-02-15' };

      const totals = await readTotals(seed, filters);
      const listed = await readAllPages(seed, filters);

      expect(totals.expenseCents).toBe(100);
      expect(listed.expenseCents).toBe(100);
      expect(totals).toEqual(listed);
    },
  );
});
