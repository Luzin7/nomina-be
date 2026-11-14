import { TransactionStatus, TransactionType } from '@constants/enums';
import * as schema from '@infra/databases/drizzle/schema';
import { AccountRepository } from '@modules/account/repositories/contracts/AccountRepository';
import { makeCheckingAccount } from '@modules/account/test-helpers/mock-factories';
import { BudgetRepository } from '@modules/budget/repositories/contracts/BudgetRepository';
import { Category } from '@modules/category/entities/Category';
import { CategoryRepository } from '@modules/category/repositories/contracts/CategoryRepository';
import { MonthProjectionRepository } from '@modules/report/repositories/contracts/MonthProjectionRepository';
import { CreateTransactionService } from '@modules/transaction/features/create-transaction/create-transaction.service';
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
import { GetAvailableToSpendService } from './get-available-to-spend.handler';

const FIRST_AMOUNT = 9_000n;
const SECOND_AMOUNT = 4_000n;

jest.setTimeout(180_000);

function unwrap<T>(result: { isLeft(): boolean; value: unknown }): T {
  if (result.isLeft()) throw result.value;
  return result.value as T;
}

type Hero = {
  budget: {
    exists: boolean;
    source?: string;
    provisional?: boolean;
    totalSpentCents: number;
  };
  state: string;
};

describe('available to spend without a budget snapshot against a real database', () => {
  let postgres: PostgresHandle;
  let app: ApplicationHandle;

  beforeAll(async () => {
    postgres = await startPostgres();
    app = await createApplication(postgres.db, new InMemoryCacheProvider());
  });

  afterAll(async () => {
    await app?.close();
    await postgres?.stop();
  });

  async function seedWorkspace() {
    const workspaceId = randomUUID();
    const userId = randomUUID();
    const accountId = randomUUID();
    const categoryId = randomUUID();
    await postgres.db.insert(schema.users).values({
      id: userId,
      email: `${userId}@example.com`,
      passwordHash: 'hash',
      name: 'Hero',
    });
    await app
      .get(WorkspaceRepository)
      .create(
        unwrap<Workspace>(
          Workspace.create({ name: 'Hero', timezone: 'UTC' }, workspaceId),
        ),
      );
    await app.get(AccountRepository).create(
      makeCheckingAccount({
        id: accountId,
        workspaceId,
        name: 'Conta',
        timezone: 'UTC',
      }),
    );
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

    return { workspaceId, userId, accountId, categoryId };
  }

  const spend = async (
    seed: Awaited<ReturnType<typeof seedWorkspace>>,
    amount: bigint,
  ) =>
    unwrap(
      await app.get(CreateTransactionService).execute({
        workspaceId: seed.workspaceId,
        sub: seed.userId,
        accountId: seed.accountId,
        categoryId: seed.categoryId,
        title: 'Gasto',
        amount,
        date: new Date().toISOString().slice(0, 10),
        type: TransactionType.EXPENSE,
        status: TransactionStatus.COMPLETED,
      } as never),
    );

  const readHero = async (seed: Awaited<ReturnType<typeof seedWorkspace>>) =>
    unwrap<Hero>(
      await app
        .get(GetAvailableToSpendService)
        .execute({ workspaceId: seed.workspaceId, sub: seed.userId }),
    );

  it('serves a provisional figure and changes it on the next read after a write', async () => {
    const seed = await seedWorkspace();
    await spend(seed, FIRST_AMOUNT);

    const warm = await readHero(seed);
    await spend(seed, SECOND_AMOUNT);
    const served = await readHero(seed);

    expect(warm.budget).toMatchObject({
      exists: true,
      source: 'provisional',
      provisional: true,
      totalSpentCents: 9_000,
    });
    expect(served.budget.totalSpentCents).toBe(13_000);
  });

  it('keeps no-budget before any expense', async () => {
    const seed = await seedWorkspace();

    const hero = await readHero(seed);

    expect(hero.state).toBe('no-budget');
    expect(hero.budget.exists).toBe(false);
  });

  it('reads the repositories a fixed number of times on a cold provisional read', async () => {
    const seed = await seedWorkspace();
    await spend(seed, FIRST_AMOUNT);
    const budgets = app.get(BudgetRepository);
    const projections = app.get(MonthProjectionRepository);
    const counted = {
      resolveSnapshot: jest.spyOn(budgets, 'resolveSnapshot'),
      findCompletedExpenseByLocalDay: jest.spyOn(
        budgets,
        'findCompletedExpenseByLocalDay',
      ),
      findActiveRecurringRules: jest.spyOn(
        projections,
        'findActiveRecurringRules',
      ),
      findMonthLedger: jest.spyOn(projections, 'findMonthLedger'),
    };

    await readHero(seed);

    const calls = Object.fromEntries(
      Object.entries(counted).map(([name, spy]) => [
        name,
        spy.mock.calls.length,
      ]),
    );
    expect(calls).toEqual({
      resolveSnapshot: 2,
      findCompletedExpenseByLocalDay: 1,
      findActiveRecurringRules: 3,
      findMonthLedger: 3,
    });
  });
});
