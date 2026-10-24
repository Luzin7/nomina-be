import {
  AccountType,
  RecurrenceFrequency,
  TransactionStatus,
  TransactionType,
} from '@constants/enums';
import { CacheProvider } from '@infra/cache/contracts/CacheProvider';
import { DrizzleService } from '@infra/databases/drizzle/drizzle.service';
import * as schema from '@infra/databases/drizzle/schema';
import { makeCheckingAccount } from '@modules/account/test-helpers/mock-factories';
import { Category } from '@modules/category/entities/Category';
import { CreateInstallmentPurchaseService } from '@modules/transaction/features/create-installment-purchase/create-installment-purchase.service';
import { GenerateRecurringTransactionsJobService } from '@modules/transaction/jobs/generate-recurring-transactions/generate-recurring-transactions.service';
import { TransactionPreviewPresenter } from '@modules/transaction/presenters/TransactionPreview.presenter';
import { CalculateNextGenerationDateService } from '@modules/transaction/services/calculate-next-generation-date.service';
import { Workspace } from '@modules/workspace/entities/Workspace';
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
import { AccountRepositoryImplementation } from './account.repository';
import { CategoryRepositoryImplementation } from './category.repository';
import { RecurringTransactionRepositoryImplementation } from './recurring-transaction.repository';
import { TransactionRepositoryImplementation } from './transaction.repository';
import { WorkspaceRepositoryImplementation } from './workspace.repository';

const MIGRATIONS_FOLDER = resolve(__dirname, '../../../../../drizzle');
const SAO_PAULO_TIMEZONE = 'America/Sao_Paulo';
const GENERATION_CLOCK = new Date('2027-03-01T12:00:00.000Z');
const INSTALLMENTS = 6;
const PAGE = { page: 1, pageSize: 50 };
const AUG_15 = '2026-08-15T03:00:00.000Z';
const SEP_15 = '2026-09-15T03:00:00.000Z';

jest.setTimeout(180_000);

class FixedClockDateProvider extends DayJsDateProvider {
  now(): Date {
    return GENERATION_CLOCK;
  }
}

class InMemoryCache implements Partial<CacheProvider> {
  readonly isEnabled = true;

  async exists(): Promise<boolean> {
    return false;
  }

  async set(): Promise<boolean> {
    return true;
  }

  async delByPattern(): Promise<number> {
    return 0;
  }

  async acquireLock(key: string) {
    return { key, token: randomUUID() };
  }

  async releaseLock(): Promise<boolean> {
    return true;
  }
}

describe('transaction list installment position against a real postgres', () => {
  let container: StartedPostgreSqlContainer;
  let queryClient: postgres.Sql;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  let repository: TransactionRepositoryImplementation;
  let purchaseService: CreateInstallmentPurchaseService;
  let generationJob: GenerateRecurringTransactionsJobService;
  let accountRepository: AccountRepositoryImplementation;

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:16-alpine')
      .withStartupTimeout(120_000)
      .start();
    queryClient = postgres(container.getConnectionUri(), {
      max: 5,
      onnotice: () => undefined,
    });
    db = drizzle(queryClient, { schema });
    await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });

    const drizzleService = { db } as unknown as DrizzleService;
    const dateProvider = new FixedClockDateProvider();
    const cache = new InMemoryCache() as unknown as CacheProvider;
    repository = new TransactionRepositoryImplementation(drizzleService);
    accountRepository = new AccountRepositoryImplementation(drizzleService);
    purchaseService = new CreateInstallmentPurchaseService(
      accountRepository,
      new CategoryRepositoryImplementation(drizzleService),
      repository,
      dateProvider,
      cache,
    );
    generationJob = new GenerateRecurringTransactionsJobService(
      new RecurringTransactionRepositoryImplementation(drizzleService),
      new CalculateNextGenerationDateService(dateProvider),
      cache,
      dateProvider,
    );
  });

  afterAll(async () => {
    await queryClient.end({ timeout: 5 });
    await container.stop();
  });

  async function seedWorkspace() {
    const workspaceId = randomUUID();
    const accountId = randomUUID();
    const categoryId = randomUUID();

    const workspace = Workspace.create(
      { name: 'Installment position', timezone: SAO_PAULO_TIMEZONE },
      workspaceId,
    );
    if (workspace.isLeft()) throw workspace.value;
    await new WorkspaceRepositoryImplementation({
      db,
    } as unknown as DrizzleService).create(workspace.value);
    await accountRepository.create(
      makeCheckingAccount({
        id: accountId,
        workspaceId,
        balance: 50_000n,
        timezone: SAO_PAULO_TIMEZONE,
        type: AccountType.CHECKING,
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
    await new CategoryRepositoryImplementation({
      db,
    } as unknown as DrizzleService).create(category.value);

    return { workspaceId, accountId, categoryId };
  }

  async function purchaseInstallments(purchaseDate: string) {
    const seed = await seedWorkspace();
    const result = await purchaseService.execute({
      sub: randomUUID(),
      workspaceId: seed.workspaceId,
      accountId: seed.accountId,
      categoryId: seed.categoryId,
      title: 'Notebook',
      totalAmount: 60_000n,
      installments: INSTALLMENTS,
      purchaseDate,
      type: TransactionType.EXPENSE,
    });
    if (result.isLeft()) throw result.value;
    await generationJob.execute();

    return seed;
  }

  async function seedRuleWithRows(
    rule: Partial<typeof schema.recurringTransactions.$inferInsert>,
    rowDates: string[],
  ) {
    const seed = await seedWorkspace();
    const recurringId = randomUUID();
    await db.insert(schema.recurringTransactions).values({
      id: recurringId,
      workspaceId: seed.workspaceId,
      accountId: seed.accountId,
      categoryId: seed.categoryId,
      title: 'Plano',
      amount: 1_000,
      type: TransactionType.EXPENSE,
      frequency: RecurrenceFrequency.MONTHLY,
      interval: 1,
      startDate: new Date(rowDates[0]),
      active: false,
      ...rule,
    });
    await db.insert(schema.transactions).values(
      rowDates.map((date) => ({
        id: randomUUID(),
        workspaceId: seed.workspaceId,
        accountId: seed.accountId,
        categoryId: seed.categoryId,
        title: 'Plano',
        amount: 1_000,
        date: new Date(date),
        type: TransactionType.EXPENSE,
        status: TransactionStatus.PENDING,
        recurringId,
      })),
    );

    return seed;
  }

  async function positionsByDay(workspaceId: string) {
    const { transactions } = await repository.listTransactionsByWorkspaceId({
      workspaceId,
      ...PAGE,
    });

    return Object.fromEntries(
      transactions
        .map((item) => TransactionPreviewPresenter.toHTTP(item))
        .map((item) => [
          item.date.toISOString().slice(0, 10),
          [item.installmentNumber, item.installmentCount],
        ]),
    );
  }

  it('should give the position of an installment purchase made through the services', async () => {
    const { workspaceId } = await purchaseInstallments('2026-08-15');

    const positions = await positionsByDay(workspaceId);

    expect(Object.keys(positions)).toHaveLength(INSTALLMENTS);
    expect(positions['2026-10-15']).toEqual([3, INSTALLMENTS]);
  });

  it('should keep the position of the remaining rows when one installment is deleted', async () => {
    const { workspaceId } = await purchaseInstallments('2026-08-15');
    await db
      .delete(schema.transactions)
      .where(
        and(
          eq(schema.transactions.workspaceId, workspaceId),
          eq(schema.transactions.date, new Date(SEP_15)),
        ),
      );

    const positions = await positionsByDay(workspaceId);

    expect(Object.keys(positions)).toHaveLength(INSTALLMENTS - 1);
    expect(positions['2026-10-15']).toEqual([3, INSTALLMENTS]);
  });

  it('should count a month-end series by month even when the generator clamps the day', async () => {
    const { workspaceId } = await purchaseInstallments('2026-01-31');

    const positions = await positionsByDay(workspaceId);

    expect(positions['2026-01-31']).toEqual([1, INSTALLMENTS]);
    expect(positions['2026-02-28']).toEqual([2, INSTALLMENTS]);
    expect(positions['2026-03-28']).toEqual([3, INSTALLMENTS]);
  });

  it('should give the position of a weekly series with an interval of two', async () => {
    const { workspaceId } = await seedRuleWithRows(
      {
        frequency: RecurrenceFrequency.WEEKLY,
        interval: 2,
        installmentCount: 4,
      },
      [
        AUG_15,
        '2026-08-29T03:00:00.000Z',
        '2026-09-12T03:00:00.000Z',
        '2026-09-26T03:00:00.000Z',
      ],
    );

    const positions = await positionsByDay(workspaceId);

    expect(positions['2026-09-12']).toEqual([3, 4]);
  });

  it('should give the position of a yearly series with an interval of two', async () => {
    const { workspaceId } = await seedRuleWithRows(
      {
        frequency: RecurrenceFrequency.YEARLY,
        interval: 2,
        installmentCount: 3,
      },
      [AUG_15, '2028-08-15T03:00:00.000Z', '2030-08-15T03:00:00.000Z'],
    );

    const positions = await positionsByDay(workspaceId);

    expect(positions['2030-08-15']).toEqual([3, 3]);
  });

  it('should give null position to a recurring rule without installment count', async () => {
    const { workspaceId } = await seedRuleWithRows({ installmentCount: null }, [
      AUG_15,
      SEP_15,
    ]);

    const positions = await positionsByDay(workspaceId);

    expect(positions['2026-09-15']).toEqual([null, null]);
  });

  it('should give null position when the row falls beyond an edited installment count', async () => {
    const { workspaceId } = await seedRuleWithRows({ installmentCount: 3 }, [
      AUG_15,
      SEP_15,
      '2026-10-15T03:00:00.000Z',
      '2026-11-15T03:00:00.000Z',
    ]);

    const positions = await positionsByDay(workspaceId);

    expect(positions['2026-10-15']).toEqual([3, 3]);
    expect(positions['2026-11-15']).toEqual([null, null]);
  });

  it('should give null position without failing the list when the rule interval is zero', async () => {
    const { workspaceId } = await seedRuleWithRows(
      { interval: 0, installmentCount: 3 },
      [AUG_15, SEP_15],
    );

    const positions = await positionsByDay(workspaceId);

    expect(positions['2026-09-15']).toEqual([null, null]);
  });
});
