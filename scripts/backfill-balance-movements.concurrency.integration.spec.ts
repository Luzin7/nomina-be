import {
  BalanceMovementCause,
  TransactionStatus,
  TransactionType,
} from '../src/constants/enums';
import { CacheProvider } from '../src/infra/cache/contracts/CacheProvider';
import { RedisService } from '../src/infra/cache/redis/RedisService';
import { DRIZZLE_TOKEN } from '../src/infra/databases/drizzle/drizzle.provider';
import { DrizzleService } from '../src/infra/databases/drizzle/drizzle.service';
import { AccountRepositoryImplementation } from '../src/infra/databases/drizzle/repositories/account.repository';
import { CategoryRepositoryImplementation } from '../src/infra/databases/drizzle/repositories/category.repository';
import { TransactionRepositoryImplementation } from '../src/infra/databases/drizzle/repositories/transaction.repository';
import { UserRepositoryImplementation } from '../src/infra/databases/drizzle/repositories/user.repository';
import { WorkspaceRepositoryImplementation } from '../src/infra/databases/drizzle/repositories/workspace.repository';
import * as schema from '../src/infra/databases/drizzle/schema';
import { AccountRepository } from '../src/modules/account/repositories/contracts/AccountRepository';
import {
  makeCheckingAccount,
  makeCreditCard,
} from '../src/modules/account/test-helpers/mock-factories';
import { Category } from '../src/modules/category/entities/Category';
import { CategoryRepository } from '../src/modules/category/repositories/contracts/CategoryRepository';
import { CreateTransactionService } from '../src/modules/transaction/features/create-transaction/create-transaction.service';
import { SetTransactionStatusService } from '../src/modules/transaction/features/set-transaction-status/set-transaction-status.service';
import { ReconcileBalancesJobService } from '../src/modules/transaction/jobs/reconcile-balances/reconcile-balances.service';
import { TransactionRepository } from '../src/modules/transaction/repositories/contracts/TransactionRepository';
import { User } from '../src/modules/user/entities/User';
import { Workspace } from '../src/modules/workspace/entities/Workspace';
import { WorkspaceRepository } from '../src/modules/workspace/repositories/contracts/WorkspaceRepository';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import {
  PostgreSqlContainer,
  StartedPostgreSqlContainer,
} from '@testcontainers/postgresql';
import { and, eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import postgres from 'postgres';
import { DateProvider } from '../src/providers/date/contracts/DateProvider';
import { DayJsDateProvider } from '../src/providers/date/implementations/Dayjs';
import { runApply } from './backfill-balance-movements';

jest.mock('@sentry/nestjs', () => ({
  init: jest.fn(),
  captureException: jest.fn(),
  flush: jest.fn().mockResolvedValue(true),
}));

type CreateRequest = Parameters<
  typeof CreateTransactionService.prototype.execute
>[0];
type SetStatusRequest = Parameters<
  typeof SetTransactionStatusService.prototype.execute
>[0];
type AccountKind = 'checking account' | 'card account';

const ACCOUNT_KINDS: AccountKind[] = ['checking account', 'card account'];
const INITIAL_BALANCE = 50_000n;
const BEFORE_BACKFILL_AMOUNT = 400n;
const AFTER_BACKFILL_AMOUNT = 1_000n;
const INCOME_AMOUNT = 300n;
const ESCAPED_WRITE = 250;
const TRANSACTION_DATE = '2024-01-20';
const MIGRATIONS_FOLDER = resolve(__dirname, '../drizzle');

jest.setTimeout(180_000);

describe('backfill and reconcile after balance writes', () => {
  let container: StartedPostgreSqlContainer;
  let queryClient: postgres.Sql;
  let moduleRef: TestingModule;
  let drizzleService: DrizzleService;
  let workspaceRepository: WorkspaceRepository;
  let accountRepository: AccountRepository;
  let categoryRepository: CategoryRepository;
  let createTransactionService: CreateTransactionService;
  let setTransactionStatusService: SetTransactionStatusService;
  let reconcileService: ReconcileBalancesJobService;

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:16-alpine')
      .withStartupTimeout(120_000)
      .start();

    queryClient = postgres(container.getConnectionUri(), {
      max: 10,
      onnotice: () => undefined,
    });
    const db = drizzle(queryClient, { schema });
    await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });

    moduleRef = await Test.createTestingModule({
      providers: [
        DrizzleService,
        { provide: DRIZZLE_TOKEN, useValue: db },
        {
          provide: WorkspaceRepository,
          useClass: WorkspaceRepositoryImplementation,
        },
        {
          provide: AccountRepository,
          useClass: AccountRepositoryImplementation,
        },
        {
          provide: CategoryRepository,
          useClass: CategoryRepositoryImplementation,
        },
        {
          provide: TransactionRepository,
          useClass: TransactionRepositoryImplementation,
        },
        { provide: CacheProvider, useClass: RedisService },
        { provide: ConfigService, useValue: {} },
        { provide: DateProvider, useClass: DayJsDateProvider },
        UserRepositoryImplementation,
        CreateTransactionService,
        SetTransactionStatusService,
        ReconcileBalancesJobService,
      ],
    }).compile();

    drizzleService = moduleRef.get(DrizzleService);
    workspaceRepository = moduleRef.get(WorkspaceRepository);
    accountRepository = moduleRef.get(AccountRepository);
    categoryRepository = moduleRef.get(CategoryRepository);
    createTransactionService = moduleRef.get(CreateTransactionService);
    setTransactionStatusService = moduleRef.get(SetTransactionStatusService);
    reconcileService = moduleRef.get(ReconcileBalancesJobService);
  });

  afterAll(async () => {
    await moduleRef?.close();
    await queryClient?.end({ timeout: 5 });
    await container?.stop();
  });

  beforeEach(async () => {
    await drizzleService.db.execute(
      sql`TRUNCATE accounts, transactions, balance_movements, workspaces, categories RESTART IDENTITY CASCADE`,
    );
  });

  async function seedAccount(kind: AccountKind) {
    const workspaceId = randomUUID();
    const accountId = randomUUID();
    const expenseCategoryId = randomUUID();
    const incomeCategoryId = randomUUID();

    const workspace = Workspace.create(
      { name: 'Reconcile after write', timezone: 'UTC' },
      workspaceId,
    );
    if (workspace.isLeft()) throw workspace.value;
    await workspaceRepository.create(workspace.value);

    const account =
      kind === 'checking account'
        ? makeCheckingAccount({
            id: accountId,
            workspaceId,
            balance: INITIAL_BALANCE,
            timezone: 'UTC',
          })
        : makeCreditCard({
            id: accountId,
            workspaceId,
            timezone: 'UTC',
            creditLimit: 10_000_000n,
          });
    await accountRepository.create(account);

    for (const [id, type] of [
      [expenseCategoryId, TransactionType.EXPENSE],
      [incomeCategoryId, TransactionType.INCOME],
    ] as const) {
      const category = Category.create(
        {
          workspaceId,
          name: `${type} ${id}`,
          type,
          parentId: null,
          isSystemCategory: false,
        },
        id,
      );
      if (category.isLeft()) throw category.value;
      await categoryRepository.create(category.value);
    }

    return { workspaceId, accountId, expenseCategoryId, incomeCategoryId };
  }

  async function createTransaction(params: {
    workspaceId: string;
    accountId: string;
    categoryId: string;
    type: TransactionType;
    status: TransactionStatus;
    amount: bigint;
  }): Promise<string> {
    const title = `Write ${randomUUID()}`;
    const result = await createTransactionService.execute({
      sub: randomUUID(),
      date: TRANSACTION_DATE,
      title,
      ...params,
    } as CreateRequest);
    if (result.isLeft()) throw result.value;

    const [row] = await drizzleService.db
      .select({ id: schema.transactions.id })
      .from(schema.transactions)
      .where(
        and(
          eq(schema.transactions.workspaceId, params.workspaceId),
          eq(schema.transactions.title, title),
        ),
      );

    return row.id;
  }

  async function runBackfill() {
    return (await runApply(queryClient)).summary;
  }

  async function ledgerOf(accountId: string) {
    const [account] = await drizzleService.db
      .select({ balance: schema.accounts.balance })
      .from(schema.accounts)
      .where(eq(schema.accounts.id, accountId));
    const movements = await drizzleService.db
      .select()
      .from(schema.balanceMovements)
      .where(eq(schema.balanceMovements.accountId, accountId))
      .orderBy(schema.balanceMovements.seq);

    return {
      balance: Number(account.balance),
      movements,
      movementsSum: movements.reduce((sum, row) => sum + row.delta, 0),
    };
  }

  type Seed = Awaited<ReturnType<typeof seedAccount>>;
  type Write = (seed: Seed) => Promise<void>;

  const writes: Array<[string, Write]> = [
    [
      'expense',
      async (seed) => {
        await createTransaction({
          ...seed,
          categoryId: seed.expenseCategoryId,
          type: TransactionType.EXPENSE,
          status: TransactionStatus.COMPLETED,
          amount: AFTER_BACKFILL_AMOUNT,
        });
      },
    ],
    [
      'income',
      async (seed) => {
        await createTransaction({
          ...seed,
          categoryId: seed.incomeCategoryId,
          type: TransactionType.INCOME,
          status: TransactionStatus.COMPLETED,
          amount: INCOME_AMOUNT,
        });
      },
    ],
    [
      'status change',
      async (seed) => {
        const transactionId = await createTransaction({
          ...seed,
          categoryId: seed.expenseCategoryId,
          type: TransactionType.EXPENSE,
          status: TransactionStatus.PENDING,
          amount: AFTER_BACKFILL_AMOUNT,
        });
        await runBackfill();
        const updated = await setTransactionStatusService.execute({
          transactionId,
          workspaceId: seed.workspaceId,
          sub: randomUUID(),
          status: TransactionStatus.COMPLETED,
        } as SetStatusRequest);
        if (updated.isLeft()) throw updated.value;
      },
    ],
  ];

  it('should skip a default account that was opened at signup', async () => {
    const user = User.create(
      {
        name: 'New User',
        email: `${randomUUID()}@example.com`,
        passwordHash: 'hash',
      },
      randomUUID(),
    );
    if (user.isLeft()) throw user.value;
    await moduleRef.get(UserRepositoryImplementation).create(user.value);

    const summary = await runBackfill();

    expect(summary.openingsInserted).toBe(0);
    expect(summary.alreadyCovered).toBe(1);
  });

  describe.each(ACCOUNT_KINDS)('%s', (kind) => {
    it.each(writes)(
      'should report no divergence after a write that follows the backfill (%s)',
      async (_label, write) => {
        const seed = await seedAccount(kind);
        await createTransaction({
          ...seed,
          categoryId: seed.expenseCategoryId,
          type: TransactionType.EXPENSE,
          status: TransactionStatus.COMPLETED,
          amount: BEFORE_BACKFILL_AMOUNT,
        });
        await runBackfill();

        await write(seed);

        const ledger = await ledgerOf(seed.accountId);
        expect(ledger.movementsSum).toBe(ledger.balance);
        expect(await reconcileService.execute()).toEqual({
          accountsChecked: 1,
          uncovered: 0,
          divergences: [],
        });
      },
    );

    it('should report a divergence when the balance is changed without a movement', async () => {
      const seed = await seedAccount(kind);
      await runBackfill();
      await drizzleService.db.execute(
        sql`UPDATE accounts SET balance = balance + ${ESCAPED_WRITE} WHERE id = ${seed.accountId}`,
      );

      const result = await reconcileService.execute();

      expect(result.divergences).toHaveLength(1);
      expect(result.divergences[0]).toMatchObject({
        accountId: seed.accountId,
        unexplained: ESCAPED_WRITE,
      });
    });

    it('should anchor the opening on the balance minus the existing movements', async () => {
      const seed = await seedAccount(kind);
      await createTransaction({
        ...seed,
        categoryId: seed.expenseCategoryId,
        type: TransactionType.EXPENSE,
        status: TransactionStatus.COMPLETED,
        amount: BEFORE_BACKFILL_AMOUNT,
      });
      const before = await ledgerOf(seed.accountId);

      await runBackfill();

      const after = await ledgerOf(seed.accountId);
      const opening = after.movements.find(
        (row) => row.cause === BalanceMovementCause.OPENING,
      );
      expect(opening?.delta).toBe(before.balance - before.movementsSum);
      expect(opening?.balanceAfter).toBe(before.balance);
      expect(after.movementsSum).toBe(after.balance);
    });

    it('should change nothing on a second backfill run', async () => {
      const seed = await seedAccount(kind);
      await runBackfill();
      const first = await ledgerOf(seed.accountId);

      const summary = await runBackfill();

      expect(summary.openingsInserted).toBe(0);
      expect(await ledgerOf(seed.accountId)).toEqual(first);
    });
  });
});
