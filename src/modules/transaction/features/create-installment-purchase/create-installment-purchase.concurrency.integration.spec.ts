import {
  BalanceMovementCause,
  TransactionStatus,
  TransactionType,
} from '@constants/enums';
import {
  CacheProvider,
  LockHandle,
} from '@infra/cache/contracts/CacheProvider';
import { RedisService } from '@infra/cache/redis/RedisService';
import { DRIZZLE_TOKEN } from '@infra/databases/drizzle/drizzle.provider';
import { DrizzleService } from '@infra/databases/drizzle/drizzle.service';
import { AccountRepositoryImplementation } from '@infra/databases/drizzle/repositories/account.repository';
import { CategoryRepositoryImplementation } from '@infra/databases/drizzle/repositories/category.repository';
import { RecurringTransactionRepositoryImplementation } from '@infra/databases/drizzle/repositories/recurring-transaction.repository';
import { TransactionRepositoryImplementation } from '@infra/databases/drizzle/repositories/transaction.repository';
import { WorkspaceRepositoryImplementation } from '@infra/databases/drizzle/repositories/workspace.repository';
import * as schema from '@infra/databases/drizzle/schema';
import { AccountRepository } from '@modules/account/repositories/contracts/AccountRepository';
import { makeCheckingAccount } from '@modules/account/test-helpers/mock-factories';
import { Category } from '@modules/category/entities/Category';
import { CategoryRepository } from '@modules/category/repositories/contracts/CategoryRepository';
import { GenerateRecurringTransactionsJobService } from '@modules/transaction/jobs/generate-recurring-transactions/generate-recurring-transactions.service';
import { RecurringTransactionRepository } from '@modules/transaction/repositories/contracts/RecurringTransactionRepository';
import { TransactionRepository } from '@modules/transaction/repositories/contracts/TransactionRepository';
import { CalculateNextGenerationDateService } from '@modules/transaction/services/calculate-next-generation-date.service';
import { NextGenerationDateCalculator } from '@modules/transaction/services/contracts/NextGenerationDateCalculator';
import {
  makeRecurring,
  makeTransaction,
} from '@modules/transaction/test-helpers/mock-factories';
import { Workspace } from '@modules/workspace/entities/Workspace';
import { WorkspaceRepository } from '@modules/workspace/repositories/contracts/WorkspaceRepository';
import { ConflictException, ExecutionContext } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { Test, TestingModule } from '@nestjs/testing';
import { IdempotencyGuard } from '@providers/auth/guards/Idempotency.guard';
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
import { CreateInstallmentPurchaseController } from './create-installment-purchase.controller';
import { CreateInstallmentPurchaseService } from './create-installment-purchase.service';

const OPENING_BALANCE = 50_000n;
const TOTAL_AMOUNT = 10_000n;
const INSTALLMENTS = 3;
const CONCURRENT_PLANS = 8;
const FIRST_INSTALLMENT_AMOUNT = 3334n;
const PAST_PURCHASE_DATE = '2024-01-10';
const CLOCK_AFTER_SECOND_INSTALLMENT = new Date('2024-03-12T12:00:00.000Z');
const MIGRATIONS_FOLDER = resolve(__dirname, '../../../../../drizzle');

jest.setTimeout(180_000);

class AdjustableClockDateProvider extends DayJsDateProvider {
  fixedNow: Date | null = null;

  now(): Date {
    return this.fixedNow ?? super.now();
  }
}

class InMemoryCache implements Partial<CacheProvider> {
  readonly isEnabled = true;
  private readonly locks = new Map<string, string>();

  async exists(): Promise<boolean> {
    return false;
  }

  async set(): Promise<boolean> {
    return true;
  }

  async delByPattern(): Promise<number> {
    return 0;
  }

  async acquireLock(key: string): Promise<LockHandle | null> {
    if (this.locks.has(key)) return null;

    const token = randomUUID();
    this.locks.set(key, token);
    return { key, token };
  }

  async releaseLock(lock: LockHandle): Promise<boolean> {
    return this.locks.delete(lock.key);
  }
}

const UTC_TIMEZONE = 'UTC';
const SAO_PAULO_TIMEZONE = 'America/Sao_Paulo';
const PINNED_NOW = new Date('2026-10-24T02:30:00.000Z');

function dateInTimezone(instant: Date, timezone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: timezone }).format(
    instant,
  );
}

describe('create installment purchase against a real database', () => {
  let container: StartedPostgreSqlContainer;
  let queryClient: postgres.Sql;
  let moduleRef: TestingModule;
  let drizzleService: DrizzleService;
  let dateProvider: AdjustableClockDateProvider;
  let workspaceRepository: WorkspaceRepository;
  let accountRepository: AccountRepository;
  let categoryRepository: CategoryRepository;
  let transactionRepository: TransactionRepository;
  let purchaseService: CreateInstallmentPurchaseService;
  let generationJob: GenerateRecurringTransactionsJobService;

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
        {
          provide: RecurringTransactionRepository,
          useClass: RecurringTransactionRepositoryImplementation,
        },
        { provide: CacheProvider, useClass: InMemoryCache },
        { provide: ConfigService, useValue: {} },
        { provide: DateProvider, useClass: AdjustableClockDateProvider },
        {
          provide: NextGenerationDateCalculator,
          useClass: CalculateNextGenerationDateService,
        },
        CreateInstallmentPurchaseService,
        GenerateRecurringTransactionsJobService,
      ],
    }).compile();

    drizzleService = moduleRef.get(DrizzleService);
    dateProvider = moduleRef.get(DateProvider);
    workspaceRepository = moduleRef.get(WorkspaceRepository);
    accountRepository = moduleRef.get(AccountRepository);
    categoryRepository = moduleRef.get(CategoryRepository);
    transactionRepository = moduleRef.get(TransactionRepository);
    purchaseService = moduleRef.get(CreateInstallmentPurchaseService);
    generationJob = moduleRef.get(GenerateRecurringTransactionsJobService);
  });

  beforeEach(() => {
    dateProvider.fixedNow = null;
  });

  afterAll(async () => {
    await moduleRef.close();
    await queryClient.end({ timeout: 5 });
    await container.stop();
  });

  async function seedWorkspace(accountTimezone = UTC_TIMEZONE) {
    const workspaceId = randomUUID();
    const accountId = randomUUID();
    const categoryId = randomUUID();

    const workspace = Workspace.create(
      { name: 'Installment purchase', timezone: 'UTC' },
      workspaceId,
    );
    if (workspace.isLeft()) throw workspace.value;
    await workspaceRepository.create(workspace.value);

    await accountRepository.create(
      makeCheckingAccount({
        id: accountId,
        workspaceId,
        balance: OPENING_BALANCE,
        timezone: accountTimezone,
      }),
    );

    const category = Category.create(
      {
        workspaceId,
        name: 'Eletrônicos',
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

  function purchaseBody(
    seed: Awaited<ReturnType<typeof seedWorkspace>>,
    purchaseDate: string,
  ) {
    return {
      accountId: seed.accountId,
      categoryId: seed.categoryId,
      title: 'Notebook',
      totalAmount: TOTAL_AMOUNT,
      installments: INSTALLMENTS,
      purchaseDate,
      type: TransactionType.EXPENSE as const,
    };
  }

  function purchaseRequest(
    seed: Awaited<ReturnType<typeof seedWorkspace>>,
    purchaseDate: string,
  ) {
    return {
      sub: randomUUID(),
      workspaceId: seed.workspaceId,
      ...purchaseBody(seed, purchaseDate),
    };
  }

  async function transactionsOf(workspaceId: string) {
    return drizzleService.db
      .select()
      .from(schema.transactions)
      .where(eq(schema.transactions.workspaceId, workspaceId))
      .orderBy(schema.transactions.date);
  }

  async function plansOf(workspaceId: string) {
    return drizzleService.db
      .select()
      .from(schema.recurringTransactions)
      .where(eq(schema.recurringTransactions.workspaceId, workspaceId));
  }

  async function movementsOf(accountId: string) {
    return drizzleService.db
      .select()
      .from(schema.balanceMovements)
      .where(eq(schema.balanceMovements.accountId, accountId));
  }

  async function balanceOf(accountId: string): Promise<bigint> {
    const account = await accountRepository.findById(accountId);
    if (!account) throw new Error('seeded account not found');

    return account.balance;
  }

  it('completes the first installment today and moves the balance once', async () => {
    dateProvider.fixedNow = PINNED_NOW;
    const seed = await seedWorkspace();
    const today = dateInTimezone(PINNED_NOW, UTC_TIMEZONE);

    const result = await purchaseService.execute(purchaseRequest(seed, today));
    if (result.isLeft()) throw result.value;

    const [plan] = await plansOf(seed.workspaceId);
    const [first] = await transactionsOf(seed.workspaceId);
    const movements = await movementsOf(seed.accountId);
    expect(plan.installmentCount).toBe(INSTALLMENTS);
    expect(plan.lastGenerated?.toISOString().slice(0, 10)).toBe(today);
    expect(first.status).toBe(TransactionStatus.COMPLETED);
    expect(first.date.toISOString().slice(0, 10)).toBe(today);
    expect(first.recurringId).toBe(plan.id);
    expect(movements).toHaveLength(1);
    expect(movements[0].cause).toBe(BalanceMovementCause.TRANSACTION_CREATED);
    expect(await balanceOf(seed.accountId)).toBe(
      OPENING_BALANCE - BigInt(first.amount),
    );
  });

  it.each([
    ['2026-10-23', TransactionStatus.COMPLETED],
    ['2026-10-24', TransactionStatus.PENDING],
  ])(
    'uses the account timezone to decide the first installment status: purchase on %s',
    async (purchaseDate, expectedStatus) => {
      dateProvider.fixedNow = PINNED_NOW;
      const seed = await seedWorkspace(SAO_PAULO_TIMEZONE);

      const result = await purchaseService.execute(
        purchaseRequest(seed, purchaseDate),
      );
      if (result.isLeft()) throw result.value;

      const [first] = await transactionsOf(seed.workspaceId);
      expect(first.status).toBe(expectedStatus);
    },
  );

  it('sums exactly 10000 cents after the job generates the remaining installments', async () => {
    const seed = await seedWorkspace();
    await purchaseService.execute(purchaseRequest(seed, PAST_PURCHASE_DATE));
    dateProvider.fixedNow = CLOCK_AFTER_SECOND_INSTALLMENT;

    const firstRun = await generationJob.execute();
    const secondRun = await generationJob.execute();

    const transactions = await transactionsOf(seed.workspaceId);
    const amounts = transactions.map((transaction) => transaction.amount);
    const dates = transactions.map((transaction) =>
      transaction.date.toISOString().slice(0, 10),
    );
    expect(firstRun.isRight()).toBe(true);
    expect(secondRun.isRight()).toBe(true);
    expect(amounts).toEqual([3334, 3333, 3333]);
    expect(amounts.reduce((sum, amount) => sum + amount, 0)).toBe(
      Number(TOTAL_AMOUNT),
    );
    expect(dates).toEqual(['2024-01-10', '2024-02-10', '2024-03-10']);
  });

  it('creates one plan when the same Idempotency-Key is sent twice', async () => {
    const seed = await seedWorkspace();
    const user = { sub: randomUUID(), workspaceId: seed.workspaceId };
    const guard = new IdempotencyGuard(
      new Reflector(),
      new InMemoryCache() as unknown as RedisService,
    );
    const body = purchaseBody(seed, PAST_PURCHASE_DATE);
    const controller = new CreateInstallmentPurchaseController(purchaseService);
    const context = {
      getHandler: () => CreateInstallmentPurchaseController.prototype.handle,
      getClass: () => CreateInstallmentPurchaseController,
      switchToHttp: () => ({
        getRequest: () => ({
          headers: { 'idempotency-key': 'same-key' },
          user,
        }),
      }),
    } as unknown as ExecutionContext;

    await guard.canActivate(context);
    await controller.handle(user as never, body);
    const secondAttempt = guard.canActivate(context);

    await expect(secondAttempt).rejects.toBeInstanceOf(ConflictException);
    expect(await plansOf(seed.workspaceId)).toHaveLength(1);
    expect(await transactionsOf(seed.workspaceId)).toHaveLength(1);
  });

  it('persists nothing when the first installment insert fails', async () => {
    const seed = await seedWorkspace();
    const recurring = makeRecurring({
      workspaceId: seed.workspaceId,
      accountId: seed.accountId,
      categoryId: seed.categoryId,
      installmentCount: INSTALLMENTS,
      id: randomUUID(),
    });
    const firstInstallment = makeTransaction({
      id: randomUUID(),
      workspaceId: seed.workspaceId,
      accountId: seed.accountId,
      categoryId: randomUUID(),
      recurringId: recurring.id,
      date: new Date('2024-01-10T00:00:00.000Z'),
    });

    const attempt = transactionRepository.createInstallmentPlan(
      { recurring, firstInstallment },
      { actorId: randomUUID() },
    );

    await expect(attempt).rejects.toThrow();
    expect(await plansOf(seed.workspaceId)).toHaveLength(0);
    expect(await transactionsOf(seed.workspaceId)).toHaveLength(0);
    expect(await movementsOf(seed.accountId)).toHaveLength(0);
    expect(await balanceOf(seed.accountId)).toBe(OPENING_BALANCE);
  });

  it('should create two plans on the same account concurrently', async () => {
    const seed = await seedWorkspace();

    const results = await Promise.all(
      Array.from({ length: CONCURRENT_PLANS }, () =>
        purchaseService.execute(purchaseRequest(seed, PAST_PURCHASE_DATE)),
      ),
    );

    const movements = await movementsOf(seed.accountId);
    expect(results.every((result) => result.isRight())).toBe(true);
    expect(await plansOf(seed.workspaceId)).toHaveLength(CONCURRENT_PLANS);
    expect(movements).toHaveLength(CONCURRENT_PLANS);
    expect(await balanceOf(seed.accountId)).toBe(
      OPENING_BALANCE - FIRST_INSTALLMENT_AMOUNT * BigInt(CONCURRENT_PLANS),
    );
  });
});
