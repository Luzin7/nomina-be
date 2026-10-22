import {
  BalanceMovementCause,
  TransactionStatus,
  TransactionType,
} from '@constants/enums';
import { CacheProvider } from '@infra/cache/contracts/CacheProvider';
import { RedisService } from '@infra/cache/redis/RedisService';
import { DRIZZLE_TOKEN } from '@infra/databases/drizzle/drizzle.provider';
import { DrizzleService } from '@infra/databases/drizzle/drizzle.service';
import { AccountRepositoryImplementation } from '@infra/databases/drizzle/repositories/account.repository';
import { CategoryRepositoryImplementation } from '@infra/databases/drizzle/repositories/category.repository';
import { TransactionRepositoryImplementation } from '@infra/databases/drizzle/repositories/transaction.repository';
import { WorkspaceRepositoryImplementation } from '@infra/databases/drizzle/repositories/workspace.repository';
import * as schema from '@infra/databases/drizzle/schema';
import { makeCheckingAccount } from '@modules/account/test-helpers/mock-factories';
import { AccountRepository } from '@modules/account/repositories/contracts/AccountRepository';
import { Category } from '@modules/category/entities/Category';
import { CategoryRepository } from '@modules/category/repositories/contracts/CategoryRepository';
import {
  TransactionAlreadyCompletedError,
  TransactionAlreadyPendingError,
  TransactionNotFoundError,
} from '@modules/transaction/errors';
import { TransactionRepository } from '@modules/transaction/repositories/contracts/TransactionRepository';
import { Workspace } from '@modules/workspace/entities/Workspace';
import { WorkspaceRepository } from '@modules/workspace/repositories/contracts/WorkspaceRepository';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { DateProvider } from '@providers/date/contracts/DateProvider';
import { DayJsDateProvider } from '@providers/date/implementations/Dayjs';
import {
  PostgreSqlContainer,
  StartedPostgreSqlContainer,
} from '@testcontainers/postgresql';
import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import postgres from 'postgres';
import { CreateTransactionService } from '../create-transaction/create-transaction.service';
import { SetTransactionStatusService } from './set-transaction-status.service';

type CreateRequest = Parameters<
  typeof CreateTransactionService.prototype.execute
>[0];
type SetStatusRequest = Parameters<
  typeof SetTransactionStatusService.prototype.execute
>[0];

const CONCURRENCY = 50;
const OPENING_BALANCE = 50_000n;
const CREATED_AMOUNT = 100n;
const SEEDED_AMOUNT = 1_000n;
const BALANCE_WITH_SEEDED_EXPENSE = OPENING_BALANCE - SEEDED_AMOUNT;
const WORKSPACE_TIMEZONE = 'UTC';
const TRANSACTION_DATE = '2024-01-20';
const MIGRATIONS_FOLDER = resolve(__dirname, '../../../../../drizzle');

jest.setTimeout(180_000);

describe('transaction status changes against a real postgres', () => {
  let container: StartedPostgreSqlContainer;
  let queryClient: postgres.Sql;
  let moduleRef: TestingModule;
  let drizzleService: DrizzleService;
  let workspaceRepository: WorkspaceRepository;
  let accountRepository: AccountRepository;
  let categoryRepository: CategoryRepository;
  let transactionRepository: TransactionRepository;
  let createTransactionService: CreateTransactionService;
  let setTransactionStatusService: SetTransactionStatusService;
  let dateProvider: DateProvider;

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
        CreateTransactionService,
        SetTransactionStatusService,
      ],
    }).compile();

    drizzleService = moduleRef.get(DrizzleService);
    workspaceRepository = moduleRef.get(WorkspaceRepository);
    accountRepository = moduleRef.get(AccountRepository);
    categoryRepository = moduleRef.get(CategoryRepository);
    transactionRepository = moduleRef.get(TransactionRepository);
    createTransactionService = moduleRef.get(CreateTransactionService);
    setTransactionStatusService = moduleRef.get(SetTransactionStatusService);
    dateProvider = moduleRef.get(DateProvider);
  });

  afterAll(async () => {
    await moduleRef?.close();
    await queryClient?.end({ timeout: 5 });
    await container?.stop();
  });

  async function seedWorkspace(): Promise<{
    workspaceId: string;
    accountId: string;
    categoryId: string;
  }> {
    const workspaceId = randomUUID();
    const accountId = randomUUID();
    const categoryId = randomUUID();

    const workspace = Workspace.create(
      { name: 'Status changes', timezone: WORKSPACE_TIMEZONE },
      workspaceId,
    );
    if (workspace.isLeft()) throw workspace.value;
    await workspaceRepository.create(workspace.value);

    const account = makeCheckingAccount({
      id: accountId,
      workspaceId,
      balance: OPENING_BALANCE,
      timezone: WORKSPACE_TIMEZONE,
    });
    await accountRepository.create(account);

    const category = Category.create(
      {
        workspaceId,
        name: 'Groceries',
        type: TransactionType.EXPENSE,
        parentId: null,
        isSystemCategory: false,
      },
      categoryId,
    );
    if (category.isLeft()) throw category.value;
    await categoryRepository.create(category.value);

    return { workspaceId, accountId, categoryId };
  }

  async function seedCompletedExpense(
    workspaceId: string,
    accountId: string,
    categoryId: string,
  ): Promise<string> {
    const title = `Seeded expense ${randomUUID()}`;
    const created = await createTransactionService.execute({
      workspaceId,
      sub: randomUUID(),
      accountId,
      categoryId,
      title,
      amount: SEEDED_AMOUNT,
      date: TRANSACTION_DATE,
      type: TransactionType.EXPENSE,
      status: TransactionStatus.COMPLETED,
    } as CreateRequest);
    if (created.isLeft()) throw created.value;

    const { transactions } =
      await transactionRepository.listTransactionsByWorkspaceId({
        workspaceId,
        page: 1,
        pageSize: 1,
        title,
      });
    const [seeded] = transactions;
    if (!seeded) throw new Error('seeded transaction not found');

    return seeded.id;
  }

  function setStatus(
    transactionId: string,
    workspaceId: string,
    status: TransactionStatus,
  ) {
    return setTransactionStatusService.execute({
      transactionId,
      workspaceId,
      status,
    } as SetStatusRequest);
  }

  async function balanceOf(accountId: string): Promise<number> {
    const account = await accountRepository.findById(accountId);
    if (!account) throw new Error('seeded account not found');

    return Number(account.balance);
  }

  async function statusOf(transactionId: string): Promise<TransactionStatus> {
    const transaction =
      await transactionRepository.findUniqueById(transactionId);
    if (!transaction) throw new Error('seeded transaction not found');

    return transaction.status;
  }

  async function statusChangesOf(transactionId: string) {
    return drizzleService.db
      .select()
      .from(schema.balanceMovements)
      .where(
        and(
          eq(schema.balanceMovements.transactionId, transactionId),
          eq(
            schema.balanceMovements.cause,
            BalanceMovementCause.STATUS_CHANGED,
          ),
        ),
      );
  }

  it('keeps the balance when 50 expenses are created for the same account', async () => {
    const { workspaceId, accountId, categoryId } = await seedWorkspace();

    const account = await accountRepository.findById(accountId);
    if (!account) throw new Error('seeded account not found');
    const today = dateProvider.format(
      new Date(),
      'YYYY-MM-DD',
      account.timezone,
    );

    const results = await Promise.all(
      Array.from({ length: CONCURRENCY }, () =>
        createTransactionService.execute({
          workspaceId,
          sub: randomUUID(),
          accountId,
          categoryId,
          title: 'Concurrent expense',
          amount: CREATED_AMOUNT,
          date: today,
          type: TransactionType.EXPENSE,
          status: TransactionStatus.COMPLETED,
        } as CreateRequest),
      ),
    );

    const failures = results
      .filter((result) => result.isLeft())
      .map((result) => result.value);
    expect(failures).toHaveLength(0);

    const storedAccount = await accountRepository.findById(accountId);
    expect(storedAccount?.balance).toBe(
      OPENING_BALANCE - BigInt(CONCURRENCY) * CREATED_AMOUNT,
    );
  });

  it('moves the balance once when the requested status differs', async () => {
    const { workspaceId, accountId, categoryId } = await seedWorkspace();
    const transactionId = await seedCompletedExpense(
      workspaceId,
      accountId,
      categoryId,
    );

    const result = await setStatus(
      transactionId,
      workspaceId,
      TransactionStatus.PENDING,
    );

    expect(result.isRight()).toBe(true);
    expect(await statusOf(transactionId)).toBe(TransactionStatus.PENDING);
    expect(await balanceOf(accountId)).toBe(Number(OPENING_BALANCE));

    const statusChanges = await statusChangesOf(transactionId);
    expect(statusChanges).toHaveLength(1);
    expect(statusChanges[0].delta).toBe(Number(SEEDED_AMOUNT));
    expect(statusChanges[0].balanceAfter).toBe(Number(OPENING_BALANCE));
  });

  it('rejects a request for the status already set and writes nothing', async () => {
    const { workspaceId, accountId, categoryId } = await seedWorkspace();
    const transactionId = await seedCompletedExpense(
      workspaceId,
      accountId,
      categoryId,
    );

    const first = await setStatus(
      transactionId,
      workspaceId,
      TransactionStatus.PENDING,
    );
    expect(first.isRight()).toBe(true);

    const second = await setStatus(
      transactionId,
      workspaceId,
      TransactionStatus.PENDING,
    );

    expect(second.isLeft()).toBe(true);
    if (second.isLeft()) {
      expect(second.value).toBeInstanceOf(TransactionAlreadyPendingError);
    }
    expect(await statusOf(transactionId)).toBe(TransactionStatus.PENDING);
    expect(await balanceOf(accountId)).toBe(Number(OPENING_BALANCE));
    expect(await statusChangesOf(transactionId)).toHaveLength(1);
  });

  it('rejects a completed transaction asked to complete again', async () => {
    const { workspaceId, accountId, categoryId } = await seedWorkspace();
    const transactionId = await seedCompletedExpense(
      workspaceId,
      accountId,
      categoryId,
    );

    const result = await setStatus(
      transactionId,
      workspaceId,
      TransactionStatus.COMPLETED,
    );

    expect(result.isLeft()).toBe(true);
    if (result.isLeft()) {
      expect(result.value).toBeInstanceOf(TransactionAlreadyCompletedError);
    }
    expect(await statusOf(transactionId)).toBe(TransactionStatus.COMPLETED);
    expect(await balanceOf(accountId)).toBe(
      Number(BALANCE_WITH_SEEDED_EXPENSE),
    );
    expect(await statusChangesOf(transactionId)).toHaveLength(0);
  });

  it('moves the balance once when 50 requests ask for the same status at once', async () => {
    const { workspaceId, accountId, categoryId } = await seedWorkspace();
    const transactionId = await seedCompletedExpense(
      workspaceId,
      accountId,
      categoryId,
    );

    const results = await Promise.all(
      Array.from({ length: CONCURRENCY }, () =>
        setStatus(transactionId, workspaceId, TransactionStatus.PENDING),
      ),
    );

    const successes = results.filter((result) => result.isRight());
    const failures = results
      .filter((result) => result.isLeft())
      .map((result) => result.value);

    expect(successes).toHaveLength(1);
    expect(failures).toHaveLength(CONCURRENCY - 1);
    expect(
      failures.every(
        (failure) => failure instanceof TransactionAlreadyPendingError,
      ),
    ).toBe(true);

    expect(await statusOf(transactionId)).toBe(TransactionStatus.PENDING);
    expect(await balanceOf(accountId)).toBe(Number(OPENING_BALANCE));
    expect(await statusChangesOf(transactionId)).toHaveLength(1);
  });

  it('returns not found and writes nothing for another workspace', async () => {
    const { workspaceId, accountId, categoryId } = await seedWorkspace();
    const transactionId = await seedCompletedExpense(
      workspaceId,
      accountId,
      categoryId,
    );

    const result = await setStatus(
      transactionId,
      randomUUID(),
      TransactionStatus.PENDING,
    );

    expect(result.isLeft()).toBe(true);
    if (result.isLeft()) {
      expect(result.value).toBeInstanceOf(TransactionNotFoundError);
    }
    expect(await statusOf(transactionId)).toBe(TransactionStatus.COMPLETED);
    expect(await balanceOf(accountId)).toBe(
      Number(BALANCE_WITH_SEEDED_EXPENSE),
    );
    expect(await statusChangesOf(transactionId)).toHaveLength(0);
  });
});
