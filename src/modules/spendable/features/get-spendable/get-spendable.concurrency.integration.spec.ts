import {
  AccountType,
  BalanceMovementCause,
  RecurrenceFrequency,
  TransactionStatus,
  TransactionType,
} from '@constants/enums';
import { DrizzleService } from '@infra/databases/drizzle/drizzle.service';
import * as schema from '@infra/databases/drizzle/schema';
import { buildInvoiceStatementFromTotals } from '@modules/account/valueObjects/InvoiceStatement';
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
import { CardCycleRepositoryImplementation } from '@infra/databases/drizzle/repositories/card-cycle.repository';
import { CardInvoiceRepositoryImplementation } from '@infra/databases/drizzle/repositories/card-invoice.repository';
import { SpendableRepositoryImplementation } from '@infra/databases/drizzle/repositories/spendable.repository';

type Database = ReturnType<typeof drizzle<typeof schema>>;

const MIGRATIONS_FOLDER = resolve(__dirname, '../../../../../drizzle');
const LOCAL_DATABASE_URL =
  process.env.SPENDABLE_TEST_DATABASE_URL ??
  'postgresql://postgres:postgres@localhost:5433/nomina_db';
const TIMEZONE = 'America/Sao_Paulo';
const WINDOW = {
  startDate: '2026-11-01',
  endDate: '2026-11-30',
  timezone: TIMEZONE,
};

jest.setTimeout(180_000);

async function isReachable(url: string): Promise<boolean> {
  const probe = postgres(url, {
    max: 1,
    connect_timeout: 2,
    onnotice: () => undefined,
  });

  try {
    await probe`SELECT 1`;
    return true;
  } catch {
    return false;
  } finally {
    await probe.end({ timeout: 5 });
  }
}

async function startServer(): Promise<{
  url: string;
  stop: () => Promise<void>;
}> {
  if (await isReachable(LOCAL_DATABASE_URL))
    return { url: LOCAL_DATABASE_URL, stop: async () => undefined };

  const container: StartedPostgreSqlContainer = await new PostgreSqlContainer(
    'postgres:17-alpine',
  )
    .withStartupTimeout(120_000)
    .start();

  return {
    url: container.getConnectionUri(),
    stop: async () => {
      await container.stop();
    },
  };
}

describe('spendable reads against a real postgres', () => {
  let server: { url: string; stop: () => Promise<void> };
  let admin: postgres.Sql;
  let client: postgres.Sql;
  let db: Database;
  let drizzleService: DrizzleService;
  let spendable: SpendableRepositoryImplementation;
  let cardCycle: CardCycleRepositoryImplementation;
  let cardInvoice: CardInvoiceRepositoryImplementation;
  let databaseName: string;
  let databaseUrl: string;
  let workspaceId: string;
  let otherWorkspaceId: string;
  let categoryId: string;

  beforeAll(async () => {
    server = await startServer();
    databaseName = `spendable_${randomUUID().replace(/-/g, '')}`;
    admin = postgres(server.url, { max: 1, onnotice: () => undefined });
    await admin.unsafe(`CREATE DATABASE "${databaseName}"`);

    const url = new URL(server.url);
    url.pathname = `/${databaseName}`;
    databaseUrl = url.toString();
    client = postgres(url.toString(), {
      max: 2,
      onnotice: () => undefined,
      connection: { TimeZone: 'UTC' },
    });
    db = drizzle(client, { schema });
    await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });

    drizzleService = new DrizzleService(db);
    spendable = new SpendableRepositoryImplementation(drizzleService);
    cardCycle = new CardCycleRepositoryImplementation(drizzleService);
    cardInvoice = new CardInvoiceRepositoryImplementation(drizzleService);
  });

  afterAll(async () => {
    await client?.end({ timeout: 5 });
    await admin?.unsafe(
      `DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`,
    );
    await admin?.end({ timeout: 5 });
    await server?.stop();
  });

  beforeEach(async () => {
    await db.execute(sql`TRUNCATE workspaces CASCADE`);
    workspaceId = randomUUID();
    otherWorkspaceId = randomUUID();
    await insertWorkspace(workspaceId);
    await insertWorkspace(otherWorkspaceId);
    categoryId = randomUUID();
    await db.insert(schema.categories).values({
      id: categoryId,
      workspaceId,
      name: 'Spending',
      type: TransactionType.EXPENSE,
    });
  });

  async function insertWorkspace(id: string): Promise<void> {
    await db.insert(schema.workspaces).values({
      id,
      name: 'Workspace',
      timezone: TIMEZONE,
      cycle: 'monthly',
    });
  }

  async function insertAccount(
    id: string,
    overrides: Partial<typeof schema.accounts.$inferInsert> = {},
  ): Promise<string> {
    await db.insert(schema.accounts).values({
      id,
      workspaceId,
      name: 'Account',
      type: AccountType.CHECKING,
      timezone: TIMEZONE,
      ...overrides,
    });

    return id;
  }

  async function insertTransaction(
    overrides: Omit<
      Partial<typeof schema.transactions.$inferInsert>,
      'date' | 'amount' | 'accountId'
    > & {
      date: string;
      amount: number;
      accountId: string;
    },
  ): Promise<string> {
    const id = randomUUID();
    await db.insert(schema.transactions).values({
      id,
      workspaceId,
      categoryId,
      title: 'Entry',
      type: TransactionType.EXPENSE,
      status: TransactionStatus.COMPLETED,
      ...overrides,
      date: new Date(overrides.date),
    });

    return id;
  }

  async function insertRecurring(
    overrides: Partial<typeof schema.recurringTransactions.$inferInsert> & {
      accountId: string;
    },
  ): Promise<string> {
    const id = randomUUID();
    await db.insert(schema.recurringTransactions).values({
      id,
      workspaceId,
      title: 'Rule',
      type: TransactionType.EXPENSE,
      amount: 50000,
      frequency: RecurrenceFrequency.MONTHLY,
      startDate: new Date('2026-11-05T12:00:00.000Z'),
      ...overrides,
    });

    return id;
  }

  async function insertMovement(
    transactionId: string,
    accountId: string,
    delta: number,
    balanceAfter: number,
  ): Promise<void> {
    await db.insert(schema.balanceMovements).values({
      workspaceId,
      accountId,
      transactionId,
      cause: BalanceMovementCause.STATUS_CHANGED,
      delta,
      balanceAfter,
    });
  }

  describe('cash flow window', () => {
    beforeEach(async () => {
      await insertAccount('checking', {
        type: AccountType.CHECKING,
        balance: 200000,
      });
      await insertAccount('cash', {
        type: AccountType.CASH,
        balance: 5000,
      });
      await insertAccount('investment', {
        type: AccountType.INVESTMENT,
        balance: 999000,
      });
    });

    it('sums only cash income and cash pending expenses inside the local window', async () => {
      await insertTransaction({
        accountId: 'checking',
        type: TransactionType.INCOME,
        amount: 100000,
        date: '2026-11-10T15:00:00.000Z',
      });
      await insertTransaction({
        accountId: 'cash',
        type: TransactionType.INCOME,
        amount: 20000,
        date: '2026-11-11T15:00:00.000Z',
      });
      await insertTransaction({
        accountId: 'investment',
        type: TransactionType.INCOME,
        amount: 777000,
        date: '2026-11-12T15:00:00.000Z',
      });
      await insertTransaction({
        accountId: 'checking',
        type: TransactionType.INCOME,
        amount: 50000,
        status: TransactionStatus.PENDING,
        date: '2026-11-13T15:00:00.000Z',
      });
      await insertTransaction({
        accountId: 'checking',
        type: TransactionType.INCOME,
        amount: 11000,
        date: '2026-11-01T02:30:00.000Z',
      });
      await insertTransaction({
        accountId: 'checking',
        type: TransactionType.INCOME,
        amount: 13000,
        date: '2026-12-01T02:30:00.000Z',
      });
      await insertTransaction({
        workspaceId: otherWorkspaceId,
        accountId: 'checking',
        type: TransactionType.INCOME,
        amount: 888000,
        date: '2026-11-14T15:00:00.000Z',
      });
      await insertTransaction({
        accountId: 'checking',
        type: TransactionType.EXPENSE,
        amount: 30000,
        status: TransactionStatus.PENDING,
        date: '2026-11-15T15:00:00.000Z',
      });
      await insertTransaction({
        accountId: 'cash',
        type: TransactionType.EXPENSE,
        amount: 7000,
        status: TransactionStatus.PENDING,
        date: '2026-11-16T15:00:00.000Z',
      });
      await insertTransaction({
        accountId: 'investment',
        type: TransactionType.EXPENSE,
        amount: 90000,
        status: TransactionStatus.PENDING,
        date: '2026-11-17T15:00:00.000Z',
      });
      await insertTransaction({
        accountId: 'checking',
        type: TransactionType.EXPENSE,
        amount: 40000,
        date: '2026-11-18T15:00:00.000Z',
      });

      const income = await spendable.sumCompletedCashIncome({
        workspaceId,
        ...WINDOW,
      });
      const { pendingCents } = await spendable.readCashSnapshot({
        workspaceId,
        ...WINDOW,
      });

      expect(income).toBe(133000);
      expect(pendingCents).toBe(37000);
    });

    it('counts only the part of a pending expense already debited', async () => {
      const debited = await insertTransaction({
        accountId: 'checking',
        amount: 20000,
        status: TransactionStatus.PENDING,
        date: '2026-11-19T15:00:00.000Z',
      });
      await insertMovement(debited, 'checking', -20000, 180000);
      const partiallyDebited = await insertTransaction({
        accountId: 'checking',
        amount: 30000,
        status: TransactionStatus.PENDING,
        date: '2026-11-20T15:00:00.000Z',
      });
      await insertMovement(partiallyDebited, 'checking', -12000, 168000);
      const reverted = await insertTransaction({
        accountId: 'checking',
        amount: 40000,
        status: TransactionStatus.PENDING,
        date: '2026-11-22T15:00:00.000Z',
      });
      await insertMovement(reverted, 'checking', 40000, 208000);

      const { pendingCents } = await spendable.readCashSnapshot({
        workspaceId,
        ...WINDOW,
      });

      expect(pendingCents).toBe(58000);
    });

    it('reads cash from the same account types as the pending expenses', async () => {
      await insertAccount('savings', { type: 'SAVINGS', balance: 70000 });
      await insertTransaction({
        accountId: 'savings',
        amount: 25000,
        status: TransactionStatus.PENDING,
        date: '2026-11-21T15:00:00.000Z',
      });

      const snapshot = await spendable.readCashSnapshot({
        workspaceId,
        ...WINDOW,
      });

      expect(snapshot.cashBalances).toEqual([
        { accountId: 'cash', balanceCents: 5000 },
        { accountId: 'checking', balanceCents: 200000 },
      ]);
      expect(snapshot.pendingCents).toBe(0);
    });

    it('reads the workspace cycle from the database', async () => {
      expect(await spendable.findCycle(workspaceId)).toBe('monthly');
      expect(await spendable.findCycle(randomUUID())).toBeNull();
    });
  });

  describe('single cash snapshot', () => {
    it('moves both halves together while a debit is held open', async () => {
      await insertAccount('checking', {
        type: AccountType.CHECKING,
        balance: 200000,
      });
      const bill = await insertTransaction({
        accountId: 'checking',
        amount: 100000,
        status: TransactionStatus.PENDING,
        date: '2026-11-19T15:00:00.000Z',
      });
      const writer = postgres(databaseUrl, {
        max: 1,
        onnotice: () => undefined,
      });

      try {
        await writer`BEGIN`;
        await writer`UPDATE accounts SET balance = balance - 100000 WHERE id = 'checking'`;
        await writer`
          INSERT INTO balance_movements (workspace_id, account_id, transaction_id, cause, delta, balance_after)
          VALUES (${workspaceId}, 'checking', ${bill}, ${BalanceMovementCause.STATUS_CHANGED}, -100000, 100000)
        `;

        const held = await spendable.readCashSnapshot({
          workspaceId,
          ...WINDOW,
        });

        await writer`COMMIT`;
        const committed = await spendable.readCashSnapshot({
          workspaceId,
          ...WINDOW,
        });

        expect(held).toEqual({
          cashBalances: [{ accountId: 'checking', balanceCents: 200000 }],
          pendingCents: 100000,
        });
        expect(committed).toEqual({
          cashBalances: [{ accountId: 'checking', balanceCents: 100000 }],
          pendingCents: 0,
        });
      } finally {
        await writer`ROLLBACK`;
        await writer.end({ timeout: 5 });
      }
    });
  });

  describe('card headroom', () => {
    beforeEach(async () => {
      await insertAccount('checking', { type: AccountType.CHECKING });
      await insertAccount('card', {
        type: AccountType.CREDIT_CARD,
        dueDay: 25,
        closingDaysBeforeDue: 5,
        creditLimit: 500000,
      });
      await db.insert(schema.cardCycleBudgets).values([
        {
          workspaceId,
          accountId: 'card',
          effectiveFrom: '2026-10-25',
          limitCents: 400000,
        },
        {
          workspaceId,
          accountId: 'card',
          effectiveFrom: '2026-11-25',
          limitCents: 500000,
        },
      ]);
    });

    it('applies the latest budget announced before the due date', async () => {
      const before = await cardCycle.findApplicableBudget(
        workspaceId,
        'card',
        '2026-11-24',
      );
      const onDueDate = await cardCycle.findApplicableBudget(
        workspaceId,
        'card',
        '2026-11-25',
      );

      expect(before?.limitCents).toBe(400000);
      expect(onDueDate?.limitCents).toBe(500000);
    });

    it('sums completed card expenses on the local days of the window', async () => {
      await insertTransaction({
        accountId: 'card',
        amount: 50000,
        date: '2026-11-10T15:00:00.000Z',
      });
      await insertTransaction({
        accountId: 'card',
        amount: 4000,
        date: '2026-11-07T02:30:00.000Z',
      });
      await insertTransaction({
        accountId: 'card',
        amount: 6000,
        date: '2026-12-07T02:30:00.000Z',
      });
      await insertTransaction({
        accountId: 'card',
        amount: 9000,
        date: '2026-12-08T02:30:00.000Z',
      });
      await insertTransaction({
        accountId: 'card',
        amount: 7000,
        status: TransactionStatus.PENDING,
        date: '2026-11-15T15:00:00.000Z',
      });
      await insertTransaction({
        accountId: 'card',
        type: TransactionType.INCOME,
        amount: 8000,
        date: '2026-11-16T15:00:00.000Z',
      });
      await insertTransaction({
        accountId: 'checking',
        amount: 11111,
        date: '2026-11-10T15:00:00.000Z',
      });

      const spend = await cardCycle.sumCycleSpend({
        workspaceId,
        accountId: 'card',
        periodStart: '2026-11-07',
        periodEnd: '2026-12-06',
        timezone: TIMEZONE,
      });
      const budget = await cardCycle.findApplicableBudget(
        workspaceId,
        'card',
        '2026-11-24',
      );

      expect(spend).toBe(56000);
      expect((budget?.limitCents ?? 0) - spend).toBe(344000);
    });
  });

  describe('carried invoice balance', () => {
    beforeEach(async () => {
      await insertAccount('checking', { type: AccountType.CHECKING });
      await insertAccount('card', {
        type: AccountType.CREDIT_CARD,
        dueDay: 25,
        closingDaysBeforeDue: 5,
      });
    });

    it('nets payments and carries the previous balance into the remaining amount', async () => {
      await insertTransaction({
        accountId: 'card',
        amount: 30000,
        date: '2026-11-01T15:00:00.000Z',
      });
      await insertTransaction({
        accountId: 'checking',
        destinationAccountId: 'card',
        type: TransactionType.TRANSFER,
        amount: 10000,
        date: '2026-11-02T15:00:00.000Z',
      });
      await insertTransaction({
        accountId: 'card',
        amount: 20000,
        date: '2026-11-10T15:00:00.000Z',
      });
      await insertTransaction({
        accountId: 'checking',
        destinationAccountId: 'card',
        type: TransactionType.TRANSFER,
        amount: 5000,
        date: '2026-11-20T15:00:00.000Z',
      });
      await insertTransaction({
        accountId: 'card',
        type: TransactionType.INCOME,
        amount: 3000,
        date: '2026-11-15T15:00:00.000Z',
      });
      await insertTransaction({
        accountId: 'checking',
        destinationAccountId: 'card',
        type: TransactionType.TRANSFER,
        amount: 12000,
        date: '2026-12-10T15:00:00.000Z',
      });
      await insertTransaction({
        accountId: 'card',
        amount: 70000,
        date: '2026-12-21T15:00:00.000Z',
      });
      await insertTransaction({
        accountId: 'card',
        amount: 9000,
        status: TransactionStatus.PENDING,
        date: '2026-11-25T15:00:00.000Z',
      });
      await insertTransaction({
        accountId: 'card',
        amount: 2000,
        status: TransactionStatus.PENDING,
        date: '2026-11-03T15:00:00.000Z',
      });

      const [totals] = await cardInvoice.findTotals(workspaceId, [
        {
          accountId: 'card',
          timezone: TIMEZONE,
          periodStart: '2026-11-06',
          periodEnd: '2026-12-05',
          today: '2026-12-20',
        },
      ]);
      const statement = buildInvoiceStatementFromTotals(totals);

      expect(totals).toEqual({
        chargesBeforePeriod: 30000n,
        paymentsBeforePeriod: 10000n,
        chargesInPeriod: 20000n,
        paymentsInPeriod: 8000n,
        paymentsAfterClosing: 12000n,
        pendingCharges: 9000n,
      });
      expect(statement.remaining).toBe(20000n);
    });
  });

  describe('active recurrences', () => {
    beforeEach(async () => {
      await insertAccount('checking', { type: AccountType.CHECKING });
      await insertAccount('investment', { type: AccountType.INVESTMENT });
    });

    it('lists active income and expense rules with their materialized dates', async () => {
      await insertRecurring({
        id: 'rule-expense',
        accountId: 'checking',
        type: TransactionType.EXPENSE,
        amount: 50000,
      });
      await insertRecurring({
        id: 'rule-income',
        accountId: 'investment',
        type: TransactionType.INCOME,
        amount: 700000,
        frequency: RecurrenceFrequency.WEEKLY,
        interval: 2,
        endDate: new Date('2027-01-01T12:00:00.000Z'),
        lastGenerated: new Date('2026-11-10T12:00:00.000Z'),
      });
      await insertRecurring({
        id: 'rule-inactive',
        accountId: 'checking',
        active: false,
      });
      await insertRecurring({
        id: 'rule-transfer',
        accountId: 'checking',
        type: TransactionType.TRANSFER,
      });
      await insertRecurring({
        id: 'rule-other-workspace',
        workspaceId: otherWorkspaceId,
        accountId: 'checking',
      });
      await insertTransaction({
        accountId: 'checking',
        amount: 50000,
        recurringId: 'rule-expense',
        date: '2026-11-05T12:00:00.000Z',
      });
      await insertTransaction({
        accountId: 'checking',
        amount: 50000,
        recurringId: 'rule-expense',
        date: '2026-12-05T12:00:00.000Z',
      });
      await insertTransaction({
        accountId: 'investment',
        type: TransactionType.INCOME,
        amount: 700000,
        status: TransactionStatus.PENDING,
        recurringId: 'rule-income',
        date: '2026-11-01T12:00:00.000Z',
      });

      const recurrences = await spendable.listActiveRecurrences(workspaceId);
      const expense = recurrences.find((rule) => rule.id === 'rule-expense');
      const income = recurrences.find((rule) => rule.id === 'rule-income');

      expect(recurrences).toHaveLength(2);
      expect(expense).toMatchObject({
        type: 'EXPENSE',
        accountType: AccountType.CHECKING,
        amount: 50000,
        frequency: RecurrenceFrequency.MONTHLY,
        interval: 1,
        endDate: null,
        lastGenerated: null,
      });
      expect(expense?.materializedDates).toEqual([
        new Date('2026-11-05T12:00:00.000Z'),
        new Date('2026-12-05T12:00:00.000Z'),
      ]);
      expect(income).toMatchObject({
        type: 'INCOME',
        accountType: AccountType.INVESTMENT,
        amount: 700000,
        interval: 2,
      });
      expect(income?.materializedDates).toEqual([
        new Date('2026-11-01T12:00:00.000Z'),
      ]);
    });
  });

  describe('statement timeout scope', () => {
    it('restores the enclosing transaction timeout after reads inside it', async () => {
      await db.transaction(async (tx) => {
        await tx.execute(sql`SET LOCAL statement_timeout = '10s'`);

        await drizzleService.runWithin(tx, async () => {
          await spendable.findCycle(workspaceId);
          await spendable.findCycle(workspaceId);

          const [restored] = await tx.execute<{ timeout: string }>(
            sql`SELECT current_setting('statement_timeout') AS "timeout"`,
          );

          expect(restored.timeout).toBe('10s');

          await tx.execute(sql`SELECT pg_sleep(1.2)`);
        });
      });
    });

    it('still bounds a read to one second inside an outer transaction', async () => {
      const attempt = db.transaction(async (tx) =>
        drizzleService.runWithin(tx, async () =>
          drizzleService.withStatementTimeout((inner) =>
            inner.execute(sql`SELECT pg_sleep(2)`),
          ),
        ),
      );

      expect(
        await (async () => {
          try {
            await attempt;
            return undefined;
          } catch (error) {
            const failure = error as {
              code?: string;
              cause?: { code?: string };
            };
            return failure.cause?.code ?? failure.code;
          }
        })(),
      ).toBe('57014');
    });
  });

  describe('determinism', () => {
    it('returns the same numbers when the same reads run twice', async () => {
      await insertAccount('checking', {
        type: AccountType.CHECKING,
        balance: 200000,
      });
      await insertAccount('card', {
        type: AccountType.CREDIT_CARD,
        dueDay: 25,
        closingDaysBeforeDue: 5,
        creditLimit: 500000,
      });
      await db.insert(schema.cardCycleBudgets).values({
        workspaceId,
        accountId: 'card',
        effectiveFrom: '2026-10-25',
        limitCents: 400000,
      });
      await insertTransaction({
        accountId: 'checking',
        type: TransactionType.INCOME,
        amount: 100000,
        date: '2026-11-10T15:00:00.000Z',
      });
      await insertTransaction({
        accountId: 'card',
        amount: 50000,
        date: '2026-11-12T15:00:00.000Z',
      });
      await insertRecurring({ accountId: 'checking' });

      const readAll = async () => ({
        cycle: await spendable.findCycle(workspaceId),
        income: await spendable.sumCompletedCashIncome({
          workspaceId,
          ...WINDOW,
        }),
        pending: (await spendable.readCashSnapshot({ workspaceId, ...WINDOW }))
          .pendingCents,
        recurrences: await spendable.listActiveRecurrences(workspaceId),
        spend: await cardCycle.sumCycleSpend({
          workspaceId,
          accountId: 'card',
          periodStart: '2026-11-07',
          periodEnd: '2026-12-06',
          timezone: TIMEZONE,
        }),
        invoice: await cardInvoice.findTotals(workspaceId, [
          {
            accountId: 'card',
            timezone: TIMEZONE,
            periodStart: '2026-11-06',
            periodEnd: '2026-12-05',
            today: '2026-12-20',
          },
        ]),
      });

      const first = await readAll();
      const second = await readAll();

      expect(second).toEqual(first);
      expect(first.income).toBe(100000);
      expect(first.spend).toBe(50000);
    });
  });
});
