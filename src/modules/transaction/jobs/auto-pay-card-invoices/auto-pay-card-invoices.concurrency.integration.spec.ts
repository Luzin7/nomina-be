import {
  BalanceMovementCause,
  TransactionStatus,
  TransactionType,
} from '@constants/enums';
import { CacheProvider } from '@infra/cache/contracts/CacheProvider';
import { DRIZZLE_TOKEN } from '@infra/databases/drizzle/drizzle.provider';
import { DrizzleService } from '@infra/databases/drizzle/drizzle.service';
import { AccountRepositoryImplementation } from '@infra/databases/drizzle/repositories/account.repository';
import { CardInvoiceSettlementRepositoryImplementation } from '@infra/databases/drizzle/repositories/card-invoice-settlement.repository';
import { TransactionRepositoryImplementation } from '@infra/databases/drizzle/repositories/transaction.repository';
import * as schema from '@infra/databases/drizzle/schema';
import { GetCreditCardInvoiceService } from '@modules/account/features/get-credit-card-invoice/get-credit-card-invoice.handler';
import { AccountRepository } from '@modules/account/repositories/contracts/AccountRepository';
import { SYSTEM_CATEGORY } from '@modules/category/constants/system-categories';
import { PayCreditCardInvoiceService } from '@modules/transaction/features/pay-credit-card-invoice/pay-credit-card-invoice.service';
import { CardInvoiceSettlementRepository } from '@modules/transaction/repositories/contracts/CardInvoiceSettlementRepository';
import { TransactionRepository } from '@modules/transaction/repositories/contracts/TransactionRepository';
import { Test, TestingModule } from '@nestjs/testing';
import { DateProvider } from '@providers/date/contracts/DateProvider';
import { DayJsDateProvider } from '@providers/date/implementations/Dayjs';
import {
  PostgreSqlContainer,
  StartedPostgreSqlContainer,
} from '@testcontainers/postgresql';
import { eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import postgres from 'postgres';
import { AutoPayCardInvoicesJobService } from './auto-pay-card-invoices.service';

const MIGRATIONS_FOLDER = resolve(__dirname, '../../../../../drizzle');
const NOW = new Date('2024-01-25T15:00:00.000Z');
const ENABLED_LONG_AGO = new Date('2023-06-01T00:00:00.000Z');
const ENABLED_AFTER_DUE_DATE = new Date('2024-01-21T10:00:00.000Z');
const CHARGE_DATE = new Date('2024-01-05T15:00:00.000Z');
const AMOUNT = 25_000;
const SOURCE_BALANCE = 100_000;
const CLAIM_TTL_MS = 30 * 60_000;
const INVOICE_MONTH = 1;
const INVOICE_YEAR = 2024;
const LOCK_HANDLE = { key: 'job:auto-pay-card-invoices', token: 'token' };

jest.setTimeout(180_000);

describe('auto pay card invoices against a real postgres', () => {
  let container: StartedPostgreSqlContainer;
  let queryClient: postgres.Sql;
  let moduleRef: TestingModule;
  let db: DrizzleService['db'];
  let service: AutoPayCardInvoicesJobService;
  let dateProvider: DayJsDateProvider;
  let payInvoice: PayCreditCardInvoiceService;
  const cache = {
    acquireLock: jest.fn(),
    releaseLock: jest.fn(),
    delByPattern: jest.fn(),
    incrementCounter: jest.fn(),
  };

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

    dateProvider = new DayJsDateProvider();

    moduleRef = await Test.createTestingModule({
      providers: [
        DrizzleService,
        { provide: DRIZZLE_TOKEN, useValue: drizzleDb },
        {
          provide: AccountRepository,
          useClass: AccountRepositoryImplementation,
        },
        {
          provide: TransactionRepository,
          useClass: TransactionRepositoryImplementation,
        },
        {
          provide: CardInvoiceSettlementRepository,
          useClass: CardInvoiceSettlementRepositoryImplementation,
        },
        { provide: CacheProvider, useValue: cache },
        { provide: DateProvider, useValue: dateProvider },
        GetCreditCardInvoiceService,
        PayCreditCardInvoiceService,
        AutoPayCardInvoicesJobService,
      ],
    }).compile();

    db = moduleRef.get(DrizzleService).db;
    service = moduleRef.get(AutoPayCardInvoicesJobService);
    payInvoice = moduleRef.get(PayCreditCardInvoiceService);
  });

  afterAll(async () => {
    await moduleRef?.close();
    await queryClient?.end({ timeout: 5 });
    await container?.stop();
  });

  beforeEach(async () => {
    jest.spyOn(dateProvider, 'now').mockReturnValue(NOW);
    cache.acquireLock.mockResolvedValue(LOCK_HANDLE);
    cache.releaseLock.mockResolvedValue(true);
    cache.delByPattern.mockResolvedValue(0);
    cache.incrementCounter.mockResolvedValue(1);
    await db.execute(
      sql`TRUNCATE accounts, transactions, balance_movements, card_invoice_settlements, workspaces, categories RESTART IDENTITY CASCADE`,
    );
    await db.insert(schema.categories).values({
      id: SYSTEM_CATEGORY.CREDIT_CARD_PAYMENT.id,
      workspaceId: null,
      name: SYSTEM_CATEGORY.CREDIT_CARD_PAYMENT.name,
      type: SYSTEM_CATEGORY.CREDIT_CARD_PAYMENT.type,
      isSystemCategory: true,
    });
  });

  interface Seed {
    workspaceId: string;
    cardId: string;
    sourceId: string;
  }

  async function seedAutopayCard(
    sourceBalance = SOURCE_BALANCE,
    enabledAt = ENABLED_LONG_AGO,
  ): Promise<Seed> {
    const workspaceId = randomUUID();
    const cardId = randomUUID();
    const sourceId = randomUUID();

    await db.insert(schema.workspaces).values({
      id: workspaceId,
      name: 'Autopay',
      timezone: 'UTC',
    });
    await db.insert(schema.accounts).values({
      id: sourceId,
      workspaceId,
      name: 'Checking',
      type: 'CHECKING',
      balance: sourceBalance,
      timezone: 'UTC',
    });
    await db.insert(schema.accounts).values({
      id: cardId,
      workspaceId,
      name: 'Card',
      type: 'CREDIT_CARD',
      balance: AMOUNT,
      timezone: 'UTC',
      dueDay: 20,
      closingDaysBeforeDue: 7,
      creditLimit: 1_000_000,
      autoPayEnabled: true,
      autoPayEnabledAt: enabledAt,
      autoPaySourceAccountId: sourceId,
    });
    await db.insert(schema.balanceMovements).values([
      {
        workspaceId,
        accountId: sourceId,
        cause: BalanceMovementCause.OPENING,
        delta: sourceBalance,
        balanceAfter: sourceBalance,
      },
      {
        workspaceId,
        accountId: cardId,
        cause: BalanceMovementCause.OPENING,
        delta: AMOUNT,
        balanceAfter: AMOUNT,
      },
    ]);
    await db.insert(schema.transactions).values({
      id: randomUUID(),
      workspaceId,
      accountId: cardId,
      categoryId: SYSTEM_CATEGORY.CREDIT_CARD_PAYMENT.id,
      title: 'Charge',
      amount: AMOUNT,
      date: CHARGE_DATE,
      type: TransactionType.EXPENSE,
      status: TransactionStatus.COMPLETED,
    });

    return { workspaceId, cardId, sourceId };
  }

  async function claimsOf(cardId: string) {
    return db
      .select()
      .from(schema.cardInvoiceSettlements)
      .where(eq(schema.cardInvoiceSettlements.cardAccountId, cardId));
  }

  async function paymentsOf(cardId: string) {
    return db
      .select()
      .from(schema.transactions)
      .where(
        sql`${schema.transactions.destinationAccountId} = ${cardId} AND ${schema.transactions.type} = ${TransactionType.TRANSFER}`,
      );
  }

  async function invoicePaidMovementsOf(workspaceId: string) {
    return db
      .select()
      .from(schema.balanceMovements)
      .where(
        sql`${schema.balanceMovements.workspaceId} = ${workspaceId} AND ${schema.balanceMovements.cause} = ${BalanceMovementCause.INVOICE_PAID}`,
      );
  }

  async function balanceOf(accountId: string): Promise<number | undefined> {
    const [row] = await db
      .select({ balance: schema.accounts.balance })
      .from(schema.accounts)
      .where(eq(schema.accounts.id, accountId));

    return row?.balance;
  }

  it('should settle once and write nothing on a second run the same day', async () => {
    const { workspaceId, cardId, sourceId } = await seedAutopayCard();

    const first = await service.execute();
    const second = await service.execute();

    expect(first.settledCount).toBe(1);
    expect(second.settledCount).toBe(0);
    expect(
      second.skipped['already-paid'] + second.skipped['already-settled'],
    ).toBe(1);
    expect(await claimsOf(cardId)).toHaveLength(1);
    expect(await paymentsOf(cardId)).toHaveLength(1);
    expect(await invoicePaidMovementsOf(workspaceId)).toHaveLength(2);
    expect(await balanceOf(sourceId)).toBe(SOURCE_BALANCE - AMOUNT);
    expect(await balanceOf(cardId)).toBe(0);
  });

  it('should settle once when two invocations overlap', async () => {
    const { cardId, sourceId } = await seedAutopayCard();

    const results = await Promise.allSettled([
      service.execute(),
      service.execute(),
    ]);

    expect(results.every(({ status }) => status === 'fulfilled')).toBe(true);
    const claims = await claimsOf(cardId);
    expect(claims).toHaveLength(1);
    expect(claims[0].transactionId).not.toBeNull();
    expect(await paymentsOf(cardId)).toHaveLength(1);
    expect(await balanceOf(sourceId)).toBe(SOURCE_BALANCE - AMOUNT);
  });

  it('should skip with insufficient-balance and write no claim nor transfer', async () => {
    const { cardId, sourceId } = await seedAutopayCard(AMOUNT - 1);

    const summary = await service.execute();

    expect(summary.skipped['insufficient-balance']).toBe(1);
    expect(summary.settledCount).toBe(0);
    expect(await claimsOf(cardId)).toHaveLength(0);
    expect(await paymentsOf(cardId)).toHaveLength(0);
    expect(await balanceOf(sourceId)).toBe(AMOUNT - 1);
  });

  it('should reclaim a stale claim without transaction and pay exactly once', async () => {
    const { workspaceId, cardId } = await seedAutopayCard();
    await db.insert(schema.cardInvoiceSettlements).values({
      workspaceId,
      cardAccountId: cardId,
      invoicePeriodMonth: INVOICE_MONTH,
      invoicePeriodYear: INVOICE_YEAR,
      createdAt: new Date(NOW.getTime() - CLAIM_TTL_MS - 60_000),
    });

    const first = await service.execute();
    const second = await service.execute();

    expect(first.settledCount).toBe(1);
    expect(second.settledCount).toBe(0);
    const claims = await claimsOf(cardId);
    expect(claims).toHaveLength(1);
    expect(claims[0].transactionId).not.toBeNull();
    expect(await paymentsOf(cardId)).toHaveLength(1);
  });

  it('should not pay again when the invoice was paid manually first', async () => {
    const { workspaceId, cardId, sourceId } = await seedAutopayCard();
    const manual = await payInvoice.execute({
      workspaceId,
      sub: 'user-1',
      creditCardAccountId: cardId,
      sourceAccountId: sourceId,
      amount: AMOUNT,
      month: INVOICE_MONTH,
      year: INVOICE_YEAR,
      categoryId: undefined,
    });
    expect(manual.isRight()).toBe(true);

    const summary = await service.execute();

    expect(summary.settledCount).toBe(0);
    expect(summary.skipped['already-paid']).toBe(1);
    expect(await paymentsOf(cardId)).toHaveLength(1);
    expect(await claimsOf(cardId)).toHaveLength(0);
  });

  it('should cascade the claim away when the payment is deleted and settle again', async () => {
    const { workspaceId, cardId, sourceId } = await seedAutopayCard();
    await service.execute();
    const [payment] = await paymentsOf(cardId);

    await db
      .delete(schema.transactions)
      .where(eq(schema.transactions.id, payment.id));
    await db
      .update(schema.accounts)
      .set({ balance: AMOUNT })
      .where(eq(schema.accounts.id, cardId));

    expect(await claimsOf(cardId)).toHaveLength(0);

    const summary = await service.execute();

    expect(summary.settledCount).toBe(1);
    expect(await claimsOf(cardId)).toHaveLength(1);
    expect(await paymentsOf(cardId)).toHaveLength(1);
    expect(await invoicePaidMovementsOf(workspaceId)).toHaveLength(4);
    expect(await balanceOf(sourceId)).toBe(SOURCE_BALANCE - 2 * AMOUNT);
  });

  it('should write no claim nor transfer for an invoice due before activation', async () => {
    const { cardId, sourceId } = await seedAutopayCard(
      SOURCE_BALANCE,
      ENABLED_AFTER_DUE_DATE,
    );

    const summary = await service.execute();

    expect(summary.settledCount).toBe(0);
    expect(await claimsOf(cardId)).toHaveLength(0);
    expect(await paymentsOf(cardId)).toHaveLength(0);
    expect(await balanceOf(sourceId)).toBe(SOURCE_BALANCE);
  });
});
