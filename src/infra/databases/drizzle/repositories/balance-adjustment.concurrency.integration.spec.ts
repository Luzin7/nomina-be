import { AccountType, BalanceMovementCause } from '@constants/enums';
import { DRIZZLE_TOKEN } from '@infra/databases/drizzle/drizzle.provider';
import { DrizzleService } from '@infra/databases/drizzle/drizzle.service';
import * as schema from '@infra/databases/drizzle/schema';
import { CheckingAccount } from '@modules/account/entities/CheckingAccount';
import { AdjustBalanceInput } from '@modules/account/repositories/contracts/AccountRepository';
import { Transaction } from '@modules/transaction/entities/Transaction';
import { ReconcileBalancesJobService } from '@modules/transaction/jobs/reconcile-balances/reconcile-balances.service';
import { right } from '@shared/core/errors/Either';
import { Test, TestingModule } from '@nestjs/testing';
import {
  PostgreSqlContainer,
  StartedPostgreSqlContainer,
} from '@testcontainers/postgresql';
import { asc, eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { resolve } from 'node:path';
import postgres from 'postgres';
import { AccountRepositoryImplementation } from './account.repository';
import { TransactionRepositoryImplementation } from './transaction.repository';

jest.mock('@sentry/nestjs', () => ({ captureException: jest.fn() }));

const MIGRATIONS_FOLDER = resolve(__dirname, '../../../../../drizzle');
const WORKSPACE_ID = 'ws-adjust';
const OTHER_WORKSPACE_ID = 'ws-adjust-other';
const ACTOR_ID = 'user-adjust';
const CATEGORY_ID = 'cat-adjust';

jest.setTimeout(180_000);

describe('balance adjustment', () => {
  let container: StartedPostgreSqlContainer;
  let queryClient: postgres.Sql;
  let moduleRef: TestingModule;
  let db: DrizzleService['db'];
  let accounts: AccountRepositoryImplementation;
  let transactions: TransactionRepositoryImplementation;
  let reconcile: ReconcileBalancesJobService;
  let accountId: string;

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:16-alpine')
      .withStartupTimeout(120_000)
      .start();
    queryClient = postgres(container.getConnectionUri(), {
      max: 10,
      onnotice: () => undefined,
    });
    const drizzleDb = drizzle(queryClient, { schema });
    await migrate(drizzleDb, { migrationsFolder: MIGRATIONS_FOLDER });

    moduleRef = await Test.createTestingModule({
      providers: [
        DrizzleService,
        { provide: DRIZZLE_TOKEN, useValue: drizzleDb },
        AccountRepositoryImplementation,
        TransactionRepositoryImplementation,
        ReconcileBalancesJobService,
      ],
    }).compile();

    db = moduleRef.get(DrizzleService).db;
    accounts = moduleRef.get(AccountRepositoryImplementation);
    transactions = moduleRef.get(TransactionRepositoryImplementation);
    reconcile = moduleRef.get(ReconcileBalancesJobService);
  });

  afterAll(async () => {
    await moduleRef.close();
    await queryClient.end({ timeout: 5 });
    await container.stop();
  });

  async function createChecking(
    workspaceId: string,
    balance: bigint,
  ): Promise<string> {
    const result = CheckingAccount.create({
      workspaceId,
      name: `Checking ${workspaceId}`,
      type: AccountType.CHECKING,
      balance,
      timezone: 'America/Sao_Paulo',
    });
    if (result.isLeft()) throw result.value;
    await accounts.createWithOpeningMovement(result.value, ACTOR_ID);
    return result.value.id;
  }

  beforeEach(async () => {
    await db.execute(
      sql`TRUNCATE users, accounts, balance_movements, balance_adjustments, categories, workspaces CASCADE`,
    );
    await db.insert(schema.users).values({
      id: ACTOR_ID,
      email: 'adjust@example.com',
      passwordHash: 'hash',
      name: 'Adjust',
    });
    await db.insert(schema.workspaces).values([
      { id: WORKSPACE_ID, name: 'Adjust' },
      { id: OTHER_WORKSPACE_ID, name: 'Adjust other' },
    ]);
    await db.insert(schema.categories).values({
      id: CATEGORY_ID,
      workspaceId: WORKSPACE_ID,
      name: 'Salário',
      type: 'INCOME',
    });
    accountId = await createChecking(WORKSPACE_ID, 1000n);
  });

  function input(overrides: Partial<AdjustBalanceInput> = {}) {
    return {
      id: 'adj-1',
      accountId,
      workspaceId: WORKSPACE_ID,
      actorId: ACTOR_ID,
      expectedBalanceCents: 1000,
      targetBalanceCents: 1500,
      ...overrides,
    };
  }

  async function balanceOf(id: string): Promise<number> {
    const [row] = await db
      .select({ balance: schema.accounts.balance })
      .from(schema.accounts)
      .where(eq(schema.accounts.id, id));
    return row.balance;
  }

  function reconciliationMovements() {
    return db
      .select()
      .from(schema.balanceMovements)
      .where(
        eq(schema.balanceMovements.cause, BalanceMovementCause.RECONCILIATION),
      );
  }

  function adjustmentRows() {
    return db
      .select()
      .from(schema.balanceAdjustments)
      .orderBy(asc(schema.balanceAdjustments.createdAt));
  }

  it('applies the adjustment, the reconciliation movement and the row together', async () => {
    const outcome = await accounts.adjustBalance(input());

    const [movement] = await reconciliationMovements();
    expect(outcome).toEqual({
      status: 'applied',
      adjustment: {
        id: 'adj-1',
        accountId,
        expectedBalanceCents: 1000,
        targetBalanceCents: 1500,
        deltaCents: 500,
        movementSeq: movement.seq,
        createdAt: expect.any(Date),
      },
    });
    expect(movement).toMatchObject({
      workspaceId: WORKSPACE_ID,
      accountId,
      transactionId: null,
      delta: 500,
      balanceAfter: 1500,
      actorId: ACTOR_ID,
    });
    expect(await balanceOf(accountId)).toBe(1500);
  });

  it('writes one movement and one row for the same id sent twice concurrently', async () => {
    const outcomes = await Promise.all([
      accounts.adjustBalance(input()),
      accounts.adjustBalance(input()),
    ]);

    expect(outcomes.map(({ status }) => status).sort()).toEqual([
      'applied',
      'replayed',
    ]);
    const [first, second] = outcomes.flatMap((outcome) =>
      'adjustment' in outcome ? [outcome.adjustment] : [],
    );
    expect(first).toEqual(second);
    expect(await reconciliationMovements()).toHaveLength(1);
    expect(await adjustmentRows()).toHaveLength(1);
    expect(await balanceOf(accountId)).toBe(1500);
  });

  it('applies one and rejects the other for two ids with the same expected balance', async () => {
    const outcomes = await Promise.all([
      accounts.adjustBalance(input({ id: 'adj-a', targetBalanceCents: 1500 })),
      accounts.adjustBalance(input({ id: 'adj-b', targetBalanceCents: 700 })),
    ]);

    expect(outcomes.map(({ status }) => status).sort()).toEqual([
      'applied',
      'balance-changed',
    ]);
    expect(await reconciliationMovements()).toHaveLength(1);
    expect(await adjustmentRows()).toHaveLength(1);
  });

  it('replays the original row when the id comes back after a later adjustment', async () => {
    const first = await accounts.adjustBalance(input());
    await accounts.adjustBalance(
      input({
        id: 'adj-2',
        expectedBalanceCents: 1500,
        targetBalanceCents: 900,
      }),
    );

    const replay = await accounts.adjustBalance(input());

    expect(replay).toEqual({
      status: 'replayed',
      adjustment: expect.objectContaining({ id: 'adj-1', deltaCents: 500 }),
    });
    expect(first).toMatchObject({ status: 'applied' });
    expect(await balanceOf(accountId)).toBe(900);
    expect(await reconciliationMovements()).toHaveLength(2);
  });

  it('rejects the same id with a different target as key-reused', async () => {
    await accounts.adjustBalance(input());

    const outcome = await accounts.adjustBalance(
      input({ targetBalanceCents: 1600 }),
    );

    expect(outcome).toEqual({ status: 'key-reused' });
    expect(await balanceOf(accountId)).toBe(1500);
  });

  it('rejects an id owned by another account as key-reused without leaking data', async () => {
    const otherAccountId = await createChecking(OTHER_WORKSPACE_ID, 1000n);
    await accounts.adjustBalance(input());

    const outcome = await accounts.adjustBalance(
      input({
        accountId: otherAccountId,
        workspaceId: OTHER_WORKSPACE_ID,
      }),
    );

    expect(outcome).toEqual({ status: 'key-reused' });
    expect(await balanceOf(otherAccountId)).toBe(1000);
  });

  it('applies one and reports key-reused for the same id on two accounts concurrently', async () => {
    const otherAccountId = await createChecking(OTHER_WORKSPACE_ID, 1000n);

    const outcomes = await Promise.all([
      accounts.adjustBalance(input()),
      accounts.adjustBalance(
        input({ accountId: otherAccountId, workspaceId: OTHER_WORKSPACE_ID }),
      ),
    ]);

    expect(outcomes.map(({ status }) => status).sort()).toEqual([
      'applied',
      'key-reused',
    ]);
    expect(await adjustmentRows()).toHaveLength(1);
  });

  it('reports a stale expected balance as balance-changed and writes nothing', async () => {
    const outcome = await accounts.adjustBalance(
      input({ expectedBalanceCents: 999 }),
    );

    expect(outcome).toEqual({ status: 'balance-changed' });
    expect(await reconciliationMovements()).toHaveLength(0);
    expect(await adjustmentRows()).toHaveLength(0);
    expect(await balanceOf(accountId)).toBe(1000);
  });

  it('writes nothing when the target equals the balance', async () => {
    const outcome = await accounts.adjustBalance(
      input({ targetBalanceCents: 1000 }),
    );

    expect(outcome).toEqual({ status: 'unchanged' });
    expect(await reconciliationMovements()).toHaveLength(0);
    expect(await adjustmentRows()).toHaveLength(0);
  });

  it.each([
    ['an unknown account', { accountId: 'missing' }],
    ['an account of another workspace', { workspaceId: OTHER_WORKSPACE_ID }],
  ])('reports account-not-found for %s', async (_label, overrides) => {
    const outcome = await accounts.adjustBalance(input(overrides));

    expect(outcome).toEqual({ status: 'account-not-found' });
    expect(await adjustmentRows()).toHaveLength(0);
  });

  it('keeps balance equal to the sum of movements across adjustments and transaction writes', async () => {
    const credit = (id: string, amount: bigint) => {
      const created = Transaction.create(
        {
          workspaceId: WORKSPACE_ID,
          accountId,
          categoryId: CATEGORY_ID,
          title: 'Entrada',
          amount,
          date: new Date('2026-11-15T12:00:00.000Z'),
          type: 'INCOME',
        },
        id,
      );
      if (created.isLeft()) throw created.value;
      return transactions.createWithBalanceUpdate(
        created.value,
        (locked) => {
          const account = locked.get(accountId);
          if (!account) throw new Error('account not locked');
          const before = account.balance;
          account.credit(amount);
          return right(new Map([[accountId, account.balance - before]]));
        },
        { actorId: ACTOR_ID },
      );
    };

    await accounts.adjustBalance(input());
    await credit('tx-1', 250n);
    await accounts.adjustBalance(
      input({
        id: 'adj-2',
        expectedBalanceCents: 1750,
        targetBalanceCents: 400,
      }),
    );
    await credit('tx-2', 100n);
    await Promise.all([
      accounts.adjustBalance(
        input({
          id: 'adj-3',
          expectedBalanceCents: 500,
          targetBalanceCents: 800,
        }),
      ),
      credit('tx-3', 50n),
    ]);

    const summary = await reconcile.execute();

    expect(summary.divergences).toEqual([]);
    expect(summary.accountsChecked).toBe(1);
  });

  it('lists the latest adjustments first, limited and scoped to the account', async () => {
    await accounts.adjustBalance(input());
    await accounts.adjustBalance(
      input({
        id: 'adj-2',
        expectedBalanceCents: 1500,
        targetBalanceCents: 900,
      }),
    );
    await accounts.adjustBalance(
      input({
        id: 'adj-3',
        expectedBalanceCents: 900,
        targetBalanceCents: 100,
      }),
    );

    const listed = await accounts.listBalanceAdjustments(
      accountId,
      WORKSPACE_ID,
      2,
    );

    expect(listed.map(({ id }) => id)).toEqual(['adj-3', 'adj-2']);
    expect(
      await accounts.listBalanceAdjustments(accountId, OTHER_WORKSPACE_ID, 2),
    ).toEqual([]);
  });
});
