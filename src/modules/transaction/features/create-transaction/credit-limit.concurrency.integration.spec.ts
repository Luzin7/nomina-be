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
import {
  CreditLimitExceededError,
  InsufficientBalanceError,
} from '@modules/account/errors';
import { AccountRepository } from '@modules/account/repositories/contracts/AccountRepository';
import {
  makeCashAccount,
  makeCreditCard,
} from '@modules/account/test-helpers/mock-factories';
import { Category } from '@modules/category/entities/Category';
import { CategoryRepository } from '@modules/category/repositories/contracts/CategoryRepository';
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
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import postgres from 'postgres';
import { CreateTransactionService } from './create-transaction.service';

type CreateRequest = Parameters<
  typeof CreateTransactionService.prototype.execute
>[0];

const CONCURRENCY = 10;
const LIMIT = 100_000n;
const CHARGE = 30_000n;
const CASH_OPENING = 10_000n;
const CASH_EXPENSE = 3_000n;
const AFFORDABLE_CHARGES = Number(LIMIT / CHARGE);
const WORKSPACE_TIMEZONE = 'UTC';
const MIGRATIONS_FOLDER = resolve(__dirname, '../../../../../drizzle');

jest.setTimeout(180_000);

describe('balance rules under concurrent creations on a real postgres', () => {
  let container: StartedPostgreSqlContainer;
  let queryClient: postgres.Sql;
  let moduleRef: TestingModule;
  let drizzleService: DrizzleService;
  let workspaceRepository: WorkspaceRepository;
  let accountRepository: AccountRepository;
  let categoryRepository: CategoryRepository;
  let createTransactionService: CreateTransactionService;
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
      ],
    }).compile();

    drizzleService = moduleRef.get(DrizzleService);
    workspaceRepository = moduleRef.get(WorkspaceRepository);
    accountRepository = moduleRef.get(AccountRepository);
    categoryRepository = moduleRef.get(CategoryRepository);
    createTransactionService = moduleRef.get(CreateTransactionService);
    dateProvider = moduleRef.get(DateProvider);
  });

  afterAll(async () => {
    await moduleRef?.close();
    await queryClient?.end({ timeout: 5 });
    await container?.stop();
  });

  async function seedWorkspace(): Promise<{
    workspaceId: string;
    categoryId: string;
  }> {
    const workspaceId = randomUUID();
    const categoryId = randomUUID();

    const workspace = Workspace.create(
      { name: 'Credit limit concurrency', timezone: WORKSPACE_TIMEZONE },
      workspaceId,
    );
    if (workspace.isLeft()) throw workspace.value;
    await workspaceRepository.create(workspace.value);

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

    return { workspaceId, categoryId };
  }

  async function seedCreditCard(workspaceId: string): Promise<string> {
    const accountId = randomUUID();
    await accountRepository.create(
      makeCreditCard({
        id: accountId,
        workspaceId,
        timezone: WORKSPACE_TIMEZONE,
        creditLimit: LIMIT,
        balance: 0n,
      }),
    );

    return accountId;
  }

  async function seedCashAccount(workspaceId: string): Promise<string> {
    const accountId = randomUUID();
    await accountRepository.create(
      makeCashAccount({
        id: accountId,
        workspaceId,
        timezone: WORKSPACE_TIMEZONE,
        balance: CASH_OPENING,
      }),
    );

    return accountId;
  }

  async function todayFor(accountId: string): Promise<string> {
    const account = await accountRepository.findById(accountId);
    if (!account) throw new Error('seeded account not found');

    return dateProvider.format(new Date(), 'YYYY-MM-DD', account.timezone);
  }

  async function fireConcurrentCharges(
    workspaceId: string,
    accountId: string,
    categoryId: string,
    amount: bigint,
    date: string,
  ) {
    return Promise.all(
      Array.from({ length: CONCURRENCY }, () =>
        createTransactionService.execute({
          workspaceId,
          sub: randomUUID(),
          accountId,
          categoryId,
          title: `Concurrent charge ${randomUUID()}`,
          amount,
          date,
          type: TransactionType.EXPENSE,
          status: TransactionStatus.COMPLETED,
        } as CreateRequest),
      ),
    );
  }

  async function balanceOf(accountId: string): Promise<bigint> {
    const account = await accountRepository.findById(accountId);
    if (!account) throw new Error('seeded account not found');

    return account.balance;
  }

  async function countTransactions(workspaceId: string): Promise<number> {
    const rows = await drizzleService.db
      .select({ id: schema.transactions.id })
      .from(schema.transactions)
      .where(eq(schema.transactions.workspaceId, workspaceId));

    return rows.length;
  }

  async function movementsOfAccount(accountId: string) {
    return drizzleService.db
      .select()
      .from(schema.balanceMovements)
      .where(eq(schema.balanceMovements.accountId, accountId))
      .orderBy(schema.balanceMovements.seq);
  }

  it('rejects charges instead of exceeding the credit limit', async () => {
    const { workspaceId, categoryId } = await seedWorkspace();
    const accountId = await seedCreditCard(workspaceId);

    const results = await fireConcurrentCharges(
      workspaceId,
      accountId,
      categoryId,
      CHARGE,
      await todayFor(accountId),
    );

    const successes = results.filter((result) => result.isRight());
    const failures = results.filter((result) => result.isLeft());

    expect(successes).toHaveLength(AFFORDABLE_CHARGES);
    expect(failures).toHaveLength(CONCURRENCY - AFFORDABLE_CHARGES);
    for (const failure of failures) {
      expect(failure.value).toBeInstanceOf(CreditLimitExceededError);
    }

    const balance = await balanceOf(accountId);
    expect(balance).toBe(BigInt(AFFORDABLE_CHARGES) * CHARGE);
    expect(balance <= LIMIT).toBe(true);
    expect(await countTransactions(workspaceId)).toBe(AFFORDABLE_CHARGES);
  });

  it('rejects expenses instead of taking the balance negative', async () => {
    const { workspaceId, categoryId } = await seedWorkspace();
    const accountId = await seedCashAccount(workspaceId);

    const results = await fireConcurrentCharges(
      workspaceId,
      accountId,
      categoryId,
      CASH_EXPENSE,
      await todayFor(accountId),
    );

    const successes = results.filter((result) => result.isRight());
    const failures = results.filter((result) => result.isLeft());
    const affordable = Number(CASH_OPENING / CASH_EXPENSE);

    expect(successes).toHaveLength(affordable);
    expect(failures).toHaveLength(CONCURRENCY - affordable);
    for (const failure of failures) {
      expect(failure.value).toBeInstanceOf(InsufficientBalanceError);
    }

    const balance = await balanceOf(accountId);
    expect(balance).toBe(CASH_OPENING - BigInt(affordable) * CASH_EXPENSE);
    expect(balance >= 0n).toBe(true);
  });

  it('keeps every written movement matching the balance after the storm', async () => {
    const { workspaceId, categoryId } = await seedWorkspace();
    const accountId = await seedCreditCard(workspaceId);
    const opening = await balanceOf(accountId);

    await fireConcurrentCharges(
      workspaceId,
      accountId,
      categoryId,
      CHARGE,
      await todayFor(accountId),
    );

    const movements = await movementsOfAccount(accountId);
    const balance = await balanceOf(accountId);
    const deltaSum = movements.reduce(
      (total, movement) => total + BigInt(movement.delta),
      0n,
    );
    const ledgerBalances = movements.map(
      (movement, index) =>
        opening +
        movements
          .slice(0, index + 1)
          .reduce((total, entry) => total + BigInt(entry.delta), 0n),
    );

    expect(movements).toHaveLength(AFFORDABLE_CHARGES);
    expect(deltaSum).toBe(balance - opening);
    expect(movements.map((movement) => BigInt(movement.balanceAfter))).toEqual(
      ledgerBalances,
    );
  });
});
