import { TransactionStatus, TransactionType } from '@constants/enums';
import * as schema from '@infra/databases/drizzle/schema';
import { AccountRepository } from '@modules/account/repositories/contracts/AccountRepository';
import {
  makeCreditCard,
  makeCheckingAccount,
} from '@modules/account/test-helpers/mock-factories';
import { BudgetRepository } from '@modules/budget/repositories/contracts/BudgetRepository';
import { CardCycleRepository } from '@modules/card-cycle/repositories/contracts/CardCycleRepository';
import { Category } from '@modules/category/entities/Category';
import { CategoryRepository } from '@modules/category/repositories/contracts/CategoryRepository';
import { MonthProjectionRepository } from '@modules/report/repositories/contracts/MonthProjectionRepository';
import type { SpendablePayload } from '@modules/spendable/presenters/Spendable.presenter';
import { SpendableRepository } from '@modules/spendable/repositories/contracts/SpendableRepository';
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
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import { randomUUID } from 'node:crypto';
import postgresJs from 'postgres';
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
  spendable: SpendablePayload | null;
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

  async function seedWorkspace(
    target: ApplicationHandle = app,
    targetDb: typeof postgres.db = postgres.db,
  ) {
    const workspaceId = randomUUID();
    const userId = randomUUID();
    const accountId = randomUUID();
    const categoryId = randomUUID();
    await targetDb.insert(schema.users).values({
      id: userId,
      email: `${userId}@example.com`,
      passwordHash: 'hash',
      name: 'Hero',
    });
    await target
      .get(WorkspaceRepository)
      .create(
        unwrap<Workspace>(
          Workspace.create({ name: 'Hero', timezone: 'UTC' }, workspaceId),
        ),
      );
    await target.get(AccountRepository).create(
      makeCheckingAccount({
        id: accountId,
        workspaceId,
        name: 'Conta',
        timezone: 'UTC',
      }),
    );
    await target.get(CategoryRepository).create(
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
    target: ApplicationHandle,
    seed: Awaited<ReturnType<typeof seedWorkspace>>,
    amount: bigint,
    status: TransactionStatus = TransactionStatus.COMPLETED,
  ) =>
    unwrap(
      await target.get(CreateTransactionService).execute({
        workspaceId: seed.workspaceId,
        sub: seed.userId,
        accountId: seed.accountId,
        categoryId: seed.categoryId,
        title: 'Gasto',
        amount,
        date: new Date().toISOString().slice(0, 10),
        type: TransactionType.EXPENSE,
        status,
      } as never),
    );

  const readHero = async (
    target: ApplicationHandle,
    seed: Awaited<ReturnType<typeof seedWorkspace>>,
  ) =>
    unwrap<Hero>(
      await target
        .get(GetAvailableToSpendService)
        .execute({ workspaceId: seed.workspaceId, sub: seed.userId }),
    );

  it('serves a provisional figure and changes it on the next read after a write', async () => {
    const seed = await seedWorkspace();
    await spend(app, seed, FIRST_AMOUNT);

    const warm = await readHero(app, seed);
    await spend(app, seed, SECOND_AMOUNT);
    const served = await readHero(app, seed);

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

    const hero = await readHero(app, seed);

    expect(hero.state).toBe('no-budget');
    expect(hero.budget.exists).toBe(false);
  });

  it('degrades to a null spendable payload when the snapshot hits the statement timeout', async () => {
    const seed = await seedWorkspace();
    await spend(app, seed, FIRST_AMOUNT, TransactionStatus.PENDING);
    let releaseLock!: () => void;
    const lockReleased = new Promise<void>((resolve) => {
      releaseLock = resolve;
    });
    let releaseLocked!: () => void;
    const lockHeld = new Promise<void>((resolve) => {
      releaseLocked = resolve;
    });
    const holder = postgres.db.transaction(async (tx) => {
      await tx.execute(
        sql`LOCK TABLE balance_movements IN ACCESS EXCLUSIVE MODE`,
      );
      releaseLocked();
      await lockReleased;
    });
    await lockHeld;

    const startedAt = Date.now();
    const hero = await readHero(app, seed).finally(releaseLock);
    const elapsedMs = Date.now() - startedAt;
    await holder;

    await spend(app, seed, SECOND_AMOUNT);
    const recovered = await readHero(app, seed);

    expect(elapsedMs).toBeGreaterThanOrEqual(1_000);
    expect(hero.spendable).toBeNull();
    expect(hero.state).toBe('no-budget');
    expect(recovered.spendable?.obligationsCents).toBe(Number(FIRST_AMOUNT));
  });

  it('reads the repositories a fixed number of times on a cold provisional read', async () => {
    const seed = await seedWorkspace();
    await spend(app, seed, FIRST_AMOUNT);
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

    await readHero(app, seed);

    const calls = Object.fromEntries(
      Object.entries(counted).map(([name, spy]) => [
        name,
        spy.mock.calls.length,
      ]),
    );
    expect(calls).toEqual({
      resolveSnapshot: 3,
      findCompletedExpenseByLocalDay: 1,
      findActiveRecurringRules: 3,
      findMonthLedger: 4,
    });
  });

  it('reads the workspace cycle once per dashboard request', async () => {
    const seed = await seedWorkspace();
    await spend(app, seed, FIRST_AMOUNT);
    const findCycle = jest.spyOn(app.get(SpendableRepository), 'findCycle');

    await readHero(app, seed);

    expect(findCycle).toHaveBeenCalledTimes(1);
  });

  it('bounds one uncached read to seventy-two statements without reading or restoring the timeout', async () => {
    const statements: string[] = [];
    const countedClient = postgresJs(postgres.url, {
      max: 5,
      fetch_types: false,
      onnotice: () => undefined,
      connection: { TimeZone: 'UTC' },
      debug: (_connection, query) => statements.push(String(query)),
    });
    const countedAppDb = drizzle(countedClient, { schema });
    const countedApp = await createApplication(
      countedAppDb,
      new InMemoryCacheProvider(),
    );

    try {
      const seed = await seedWorkspace(countedApp, countedAppDb);
      await spend(countedApp, seed, FIRST_AMOUNT);

      statements.length = 0;
      await readHero(countedApp, seed);

      expect(statements.length).toBeLessThanOrEqual(72);
      expect(
        statements.filter((statement) =>
          /current_setting\('statement_timeout'\)|set_config\('statement_timeout'/.test(
            statement,
          ),
        ),
      ).toEqual([]);
    } finally {
      await countedApp.close();
      await countedClient.end({ timeout: 5 });
    }
  });

  it('keeps the card reads flat as cards are added', async () => {
    const statements: string[] = [];
    const countedClient = postgresJs(postgres.url, {
      max: 5,
      fetch_types: false,
      onnotice: () => undefined,
      connection: { TimeZone: 'UTC' },
      debug: (_connection, query) => statements.push(String(query)),
    });
    const countedAppDb = drizzle(countedClient, { schema });
    const countedApp = await createApplication(
      countedAppDb,
      new InMemoryCacheProvider(),
    );

    const countRead = async (
      seed: Awaited<ReturnType<typeof seedWorkspace>>,
    ): Promise<number> => {
      statements.length = 0;
      await readHero(countedApp, seed);
      return statements.length;
    };

    const seedWithCards = async (cards: number) => {
      const seed = await seedWorkspace(countedApp, countedAppDb);
      for (let index = 0; index < cards; index += 1) {
        const card = makeCreditCard({
          id: randomUUID(),
          workspaceId: seed.workspaceId,
          dueDay: 15,
        });
        await countedApp.get(AccountRepository).create(card);
        await countedApp.get(CardCycleRepository).saveBudget({
          workspaceId: seed.workspaceId,
          accountId: card.id,
          effectiveFrom: '2026-01-01',
          limitCents: 10_000 * (index + 1),
        });
      }
      await spend(countedApp, seed, FIRST_AMOUNT);
      return seed;
    };

    try {
      const cardless = await countRead(await seedWithCards(0));
      const oneCard = await countRead(await seedWithCards(1));
      const fourCardsSeed = await seedWithCards(4);
      const fourCards = await countRead(fourCardsSeed);
      const hero = await readHero(countedApp, fourCardsSeed);

      expect(hero.spendable?.cards).toHaveLength(4);
      expect(oneCard - cardless).toBe(fourCards - cardless);
      expect(fourCards - cardless).toBeLessThanOrEqual(12);
    } finally {
      await countedApp.close();
      await countedClient.end({ timeout: 5 });
    }
  });
});
