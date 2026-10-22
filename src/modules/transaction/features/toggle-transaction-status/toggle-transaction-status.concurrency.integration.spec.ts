import { TransactionStatus, TransactionType } from '@constants/enums';
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
import { makeTransaction } from '@modules/transaction/test-helpers/mock-factories';
import { Transaction } from '@modules/transaction/entities/Transaction';
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
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import postgres from 'postgres';
import { CreateTransactionService } from '../create-transaction/create-transaction.service';
import { ToggleTransactionStatusService } from './toggle-transaction-status.service';

type CreateRequest = Parameters<
  typeof CreateTransactionService.prototype.execute
>[0];
type ToggleRequest = Parameters<
  typeof ToggleTransactionStatusService.prototype.execute
>[0];

const CONCURRENCY = 50;
const OPENING_BALANCE = 50_000n;
const CREATED_AMOUNT = 100n;
const SEEDED_AMOUNT = 1_000n;
const PENDING_BASELINE_BALANCE = OPENING_BALANCE + SEEDED_AMOUNT;
const WORKSPACE_TIMEZONE = 'UTC';
const MIGRATIONS_FOLDER = resolve(__dirname, '../../../../../drizzle');

jest.setTimeout(180_000);

describe('account balance under concurrent mutations on a real postgres', () => {
  let container: StartedPostgreSqlContainer;
  let queryClient: postgres.Sql;
  let moduleRef: TestingModule;
  let workspaceRepository: WorkspaceRepository;
  let accountRepository: AccountRepository;
  let categoryRepository: CategoryRepository;
  let transactionRepository: TransactionRepository;
  let createTransactionService: CreateTransactionService;
  let toggleTransactionStatusService: ToggleTransactionStatusService;
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
        ToggleTransactionStatusService,
      ],
    }).compile();

    workspaceRepository = moduleRef.get(WorkspaceRepository);
    accountRepository = moduleRef.get(AccountRepository);
    categoryRepository = moduleRef.get(CategoryRepository);
    transactionRepository = moduleRef.get(TransactionRepository);
    createTransactionService = moduleRef.get(CreateTransactionService);
    toggleTransactionStatusService = moduleRef.get(
      ToggleTransactionStatusService,
    );
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
      { name: 'Concurrency', timezone: WORKSPACE_TIMEZONE },
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
  ): Promise<Transaction> {
    const transaction = makeTransaction({
      id: randomUUID(),
      workspaceId,
      accountId,
      categoryId,
      amount: SEEDED_AMOUNT,
      date: new Date('2024-01-20T12:00:00.000Z'),
      type: TransactionType.EXPENSE,
      status: TransactionStatus.COMPLETED,
    });
    await transactionRepository.create(transaction);

    return transaction;
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

  it('keeps status and balance consistent when 50 toggles hit the same transaction', async () => {
    const { workspaceId, accountId, categoryId } = await seedWorkspace();
    const transaction = await seedCompletedExpense(
      workspaceId,
      accountId,
      categoryId,
    );

    const results = await Promise.all(
      Array.from({ length: CONCURRENCY }, () =>
        toggleTransactionStatusService.execute({
          transactionId: transaction.id,
          workspaceId,
        } as ToggleRequest),
      ),
    );

    const failures = results
      .filter((result) => result.isLeft())
      .map((result) => result.value);
    expect(failures).toHaveLength(0);

    const [storedTransaction, storedAccount] = await Promise.all([
      transactionRepository.findUniqueById(transaction.id),
      accountRepository.findById(accountId),
    ]);

    const finalStatus = storedTransaction?.status;
    const expectedBalance =
      finalStatus === TransactionStatus.COMPLETED
        ? PENDING_BASELINE_BALANCE - SEEDED_AMOUNT
        : PENDING_BASELINE_BALANCE;

    expect(finalStatus).toBe(TransactionStatus.COMPLETED);
    expect(storedAccount?.balance).toBe(expectedBalance);
  });
});
