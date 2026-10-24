import { BALANCE_BACKFILL_ACTOR } from '@constants/actors';
import { TransactionStatus, TransactionType } from '@constants/enums';
import { CacheProvider } from '@infra/cache/contracts/CacheProvider';
import { RedisService } from '@infra/cache/redis/RedisService';
import { DRIZZLE_TOKEN } from '@infra/databases/drizzle/drizzle.provider';
import { DrizzleService } from '@infra/databases/drizzle/drizzle.service';
import { AccountRepositoryImplementation } from '@infra/databases/drizzle/repositories/account.repository';
import { CategoryRepositoryImplementation } from '@infra/databases/drizzle/repositories/category.repository';
import { MonthProjectionRepositoryImplementation } from '@infra/databases/drizzle/repositories/month-projection.repository';
import { TransactionRepositoryImplementation } from '@infra/databases/drizzle/repositories/transaction.repository';
import { WorkspaceRepositoryImplementation } from '@infra/databases/drizzle/repositories/workspace.repository';
import * as schema from '@infra/databases/drizzle/schema';
import { InvestmentAccount } from '@modules/account/entities/InvestmentAccount';
import { AccountRepository } from '@modules/account/repositories/contracts/AccountRepository';
import {
  makeCheckingAccount,
  makeCreditCard,
} from '@modules/account/test-helpers/mock-factories';
import { Category } from '@modules/category/entities/Category';
import { CategoryRepository } from '@modules/category/repositories/contracts/CategoryRepository';
import { MonthProjectionRepository } from '@modules/report/repositories/contracts/MonthProjectionRepository';
import { CreateTransactionService } from '@modules/transaction/features/create-transaction/create-transaction.service';
import { PayCreditCardInvoiceService } from '@modules/transaction/features/pay-credit-card-invoice/pay-credit-card-invoice.service';
import { TransactionRepository } from '@modules/transaction/repositories/contracts/TransactionRepository';
import { Workspace } from '@modules/workspace/entities/Workspace';
import { WorkspaceRepository } from '@modules/workspace/repositories/contracts/WorkspaceRepository';
import { GetWorkspaceTimezoneService } from '@modules/workspace/services/get-workspace-timezone.service';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { DateProvider } from '@providers/date/contracts/DateProvider';
import { DayJsDateProvider } from '@providers/date/implementations/Dayjs';
import {
  PostgreSqlContainer,
  StartedPostgreSqlContainer,
} from '@testcontainers/postgresql';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import postgres from 'postgres';
import { FindMonthSummaryService } from '../get-month-summary/get-month-summary.service';
import { BalanceEvolutionService } from './get-balance-evolution.handler';

type CreateRequest = Parameters<
  typeof CreateTransactionService.prototype.execute
>[0];
type PayInvoiceRequest = Parameters<
  typeof PayCreditCardInvoiceService.prototype.execute
>[0];

type SeededWorkspace = {
  workspaceId: string;
  checkingId: string;
  investmentId: string;
  cardId: string;
  categoryId: string;
};

const NOW = new Date('2026-10-23T15:00:00.000Z');
const MIGRATIONS_FOLDER = resolve(__dirname, '../../../../../drizzle');
const WORKSPACE_TIMEZONES = ['America/Sao_Paulo', 'UTC'] as const;

const EXPECTED_DAILY_NET_WORTH = [
  { date: '2026-10-16', balance: 1300 },
  { date: '2026-10-17', balance: 4300 },
  { date: '2026-10-18', balance: 4150 },
  { date: '2026-10-19', balance: 4110 },
  { date: '2026-10-20', balance: 3860 },
  { date: '2026-10-21', balance: 3860 },
  { date: '2026-10-22', balance: 3870 },
  { date: '2026-10-23', balance: 3870 },
];

class FixedNowDateProvider extends DayJsDateProvider {
  now(): Date {
    return NOW;
  }
}

jest.setTimeout(180_000);

describe('balance evolution net worth series', () => {
  let container: StartedPostgreSqlContainer;
  let queryClient: postgres.Sql;
  let moduleRef: TestingModule;
  let drizzleService: DrizzleService;
  let workspaceRepository: WorkspaceRepository;
  let accountRepository: AccountRepository;
  let categoryRepository: CategoryRepository;
  let createTransactionService: CreateTransactionService;
  let payCreditCardInvoiceService: PayCreditCardInvoiceService;
  let balanceEvolutionService: BalanceEvolutionService;
  let monthSummaryService: FindMonthSummaryService;

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
          provide: MonthProjectionRepository,
          useClass: MonthProjectionRepositoryImplementation,
        },
        { provide: CacheProvider, useClass: RedisService },
        { provide: ConfigService, useValue: {} },
        { provide: DateProvider, useValue: new FixedNowDateProvider() },
        GetWorkspaceTimezoneService,
        CreateTransactionService,
        PayCreditCardInvoiceService,
        BalanceEvolutionService,
        FindMonthSummaryService,
      ],
    }).compile();

    drizzleService = moduleRef.get(DrizzleService);
    workspaceRepository = moduleRef.get(WorkspaceRepository);
    accountRepository = moduleRef.get(AccountRepository);
    categoryRepository = moduleRef.get(CategoryRepository);
    createTransactionService = moduleRef.get(CreateTransactionService);
    payCreditCardInvoiceService = moduleRef.get(PayCreditCardInvoiceService);
    balanceEvolutionService = moduleRef.get(BalanceEvolutionService);
    monthSummaryService = moduleRef.get(FindMonthSummaryService);
  });

  afterAll(async () => {
    await moduleRef.close();
    await queryClient.end({ timeout: 5 });
    await container.stop();
  });

  beforeEach(async () => {
    await drizzleService.db.execute(
      sql`TRUNCATE workspaces, accounts, categories, transactions, balance_movements RESTART IDENTITY CASCADE`,
    );
  });

  async function seedWorkspace(timezone: string): Promise<SeededWorkspace> {
    const workspaceId = randomUUID();
    const checkingId = randomUUID();
    const investmentId = randomUUID();
    const cardId = randomUUID();
    const categoryId = randomUUID();

    const workspace = Workspace.create(
      { name: 'Net worth', timezone },
      workspaceId,
    );
    if (workspace.isLeft()) throw workspace.value;
    await workspaceRepository.create(workspace.value);

    const investment = InvestmentAccount.create(
      { workspaceId, name: 'Investments', timezone, balance: 50_000n },
      investmentId,
    );
    if (investment.isLeft()) throw investment.value;

    await accountRepository.createWithOpeningMovement(
      makeCheckingAccount({
        id: checkingId,
        workspaceId,
        timezone,
        balance: 100_000n,
      }),
      BALANCE_BACKFILL_ACTOR,
    );
    await accountRepository.createWithOpeningMovement(
      investment.value,
      BALANCE_BACKFILL_ACTOR,
    );
    await accountRepository.createWithOpeningMovement(
      makeCreditCard({
        id: cardId,
        workspaceId,
        timezone,
        balance: 20_000n,
      }),
      BALANCE_BACKFILL_ACTOR,
    );

    const category = Category.create(
      {
        workspaceId,
        name: 'General',
        type: TransactionType.EXPENSE,
        parentId: null,
        isSystemCategory: false,
      },
      categoryId,
    );
    if (category.isLeft()) throw category.value;
    await categoryRepository.create(category.value);

    return { workspaceId, checkingId, investmentId, cardId, categoryId };
  }

  async function createTransaction(
    seeded: SeededWorkspace,
    request: Partial<CreateRequest> &
      Pick<CreateRequest, 'accountId' | 'amount' | 'date' | 'type'>,
  ): Promise<void> {
    const result = await createTransactionService.execute({
      workspaceId: seeded.workspaceId,
      sub: randomUUID(),
      categoryId: seeded.categoryId,
      title: `Net worth ${randomUUID()}`,
      status: TransactionStatus.COMPLETED,
      ...request,
    } as CreateRequest);
    if (result.isLeft()) throw result.value;
  }

  async function seedActivity(seeded: SeededWorkspace): Promise<void> {
    const { checkingId, investmentId, cardId } = seeded;

    await createTransaction(seeded, {
      accountId: checkingId,
      amount: 300_000n,
      date: '2026-10-17',
      type: TransactionType.INCOME,
    });
    await createTransaction(seeded, {
      accountId: cardId,
      amount: 15_000n,
      date: '2026-10-18',
      type: TransactionType.EXPENSE,
    });
    await createTransaction(seeded, {
      accountId: checkingId,
      amount: 4_000n,
      date: '2026-10-19',
      type: TransactionType.EXPENSE,
    });
    await createTransaction(seeded, {
      accountId: cardId,
      amount: 25_000n,
      date: '2026-10-20',
      type: TransactionType.EXPENSE,
    });
    await createTransaction(seeded, {
      accountId: checkingId,
      destinationAccountId: investmentId,
      amount: 10_000n,
      date: '2026-10-21',
      type: TransactionType.TRANSFER,
    });
    await createTransaction(seeded, {
      accountId: investmentId,
      amount: 1_000n,
      date: '2026-10-22',
      type: TransactionType.INCOME,
    });

    const payment = await payCreditCardInvoiceService.execute({
      workspaceId: seeded.workspaceId,
      sub: randomUUID(),
      creditCardAccountId: cardId,
      sourceAccountId: checkingId,
      categoryId: seeded.categoryId,
      amount: 40_000,
    } as PayInvoiceRequest);
    if (payment.isLeft()) throw payment.value;
  }

  async function headlineNetWorthInReais(workspaceId: string): Promise<number> {
    const summary = await monthSummaryService.execute({
      workspaceId,
      sub: randomUUID(),
    });
    if (summary.isLeft()) throw summary.value;

    const { totalCheckingBalance, totalInvestmentBalance } = summary.value;
    const cardDebt = summary.value.totalCreditCardBalance;

    return (totalCheckingBalance + totalInvestmentBalance - cardDebt) / 100;
  }

  describe.each(WORKSPACE_TIMEZONES)('workspace in %s', (timezone) => {
    it('returns the daily net worth with card purchases lowering it and transfers leaving it untouched', async () => {
      const seeded = await seedWorkspace(timezone);
      await seedActivity(seeded);

      const result = await balanceEvolutionService.execute({
        workspaceId: seeded.workspaceId,
        sub: randomUUID(),
        period: '7d',
      });
      if (result.isLeft()) throw result.value;

      const dailyNetWorth = result.value.netWorth.map(({ date, balance }) => ({
        date,
        balance,
      }));

      expect(dailyNetWorth).toEqual(EXPECTED_DAILY_NET_WORTH);
    });

    it('ends on the month-summary net worth', async () => {
      const seeded = await seedWorkspace(timezone);
      await seedActivity(seeded);

      const result = await balanceEvolutionService.execute({
        workspaceId: seeded.workspaceId,
        sub: randomUUID(),
        period: '7d',
      });
      if (result.isLeft()) throw result.value;

      expect(result.value.netWorth.at(-1)?.balance).toBe(
        await headlineNetWorthInReais(seeded.workspaceId),
      );
    });
  });
});
