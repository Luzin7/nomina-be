import {
  AccountType,
  TransactionStatus,
  TransactionType,
} from '@constants/enums';
import { DrizzleService } from '@infra/databases/drizzle/drizzle.service';
import * as schema from '@infra/databases/drizzle/schema';
import { CardInvoiceWindow } from '@modules/account/valueObjects/CardInvoiceWindow';
import { InvoiceCalendar } from '@modules/account/valueObjects/InvoiceCalendar';
import {
  buildInvoiceStatement,
  buildInvoiceStatementFromTotals,
  StatementEntry,
} from '@modules/account/valueObjects/InvoiceStatement';
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
import { CardInvoiceRepositoryImplementation } from './card-invoice.repository';

type Database = ReturnType<typeof drizzle<typeof schema>>;

const MIGRATIONS_FOLDER = resolve(__dirname, '../../../../../drizzle');
const TIMEZONE = 'America/Sao_Paulo';
const TODAY = '2026-10-20';
const KEY = '2026-10';

jest.setTimeout(180_000);

describe('CardInvoiceRepositoryImplementation against a real postgres', () => {
  let container: StartedPostgreSqlContainer;
  let queryClient: postgres.Sql;
  let db: Database;
  let repository: CardInvoiceRepositoryImplementation;
  let workspaceId: string;
  let otherWorkspaceId: string;
  let cardId: string;
  let otherCardId: string;
  let checkingId: string;
  let categoryId: string;
  const calendar = new InvoiceCalendar({
    dueDay: 15,
    closingDaysBeforeDue: 5,
  });
  const dateProvider = new DayJsDateProvider();

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:17-alpine')
      .withStartupTimeout(120_000)
      .start();

    queryClient = postgres(container.getConnectionUri(), {
      max: 2,
      onnotice: () => undefined,
      connection: { TimeZone: 'UTC' },
    });
    db = drizzle(queryClient, { schema });

    await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });

    repository = new CardInvoiceRepositoryImplementation({
      db,
    } as unknown as DrizzleService);
  });

  afterAll(async () => {
    await queryClient.end({ timeout: 5 });
    await container.stop();
  });

  beforeEach(async () => {
    await db.execute(
      sql`TRUNCATE workspaces, accounts, categories, transactions RESTART IDENTITY CASCADE`,
    );

    workspaceId = randomUUID();
    otherWorkspaceId = randomUUID();
    cardId = randomUUID();
    otherCardId = randomUUID();
    checkingId = randomUUID();
    categoryId = randomUUID();

    await db.insert(schema.workspaces).values([
      { id: workspaceId, name: 'Workspace' },
      { id: otherWorkspaceId, name: 'Other' },
    ]);
    await db.insert(schema.accounts).values([
      cardRow(cardId, 'Cartão'),
      cardRow(otherCardId, 'Outro cartão'),
      {
        id: checkingId,
        workspaceId,
        name: 'Conta',
        type: AccountType.CHECKING,
        timezone: TIMEZONE,
      },
    ]);
    await db.insert(schema.categories).values({
      id: categoryId,
      workspaceId,
      name: 'Mercado',
      type: TransactionType.EXPENSE,
    });
  });

  function cardRow(id: string, name: string) {
    return {
      id,
      workspaceId,
      name,
      type: AccountType.CREDIT_CARD,
      timezone: TIMEZONE,
      dueDay: 15,
      closingDaysBeforeDue: 5,
    };
  }

  function windowOf(accountId: string): CardInvoiceWindow {
    const { periodStart, periodEnd } = calendar.bounds(KEY);

    return {
      accountId,
      timezone: TIMEZONE,
      periodStart,
      periodEnd,
      today: TODAY,
    };
  }

  async function insertTransaction(
    overrides: Partial<
      Omit<typeof schema.transactions.$inferInsert, 'date'>
    > & {
      date: string;
      amount: number;
    },
  ): Promise<string> {
    const id = randomUUID();
    await db.insert(schema.transactions).values({
      id,
      workspaceId,
      accountId: cardId,
      categoryId,
      title: 'Lançamento',
      type: TransactionType.EXPENSE,
      status: TransactionStatus.COMPLETED,
      ...overrides,
      date: new Date(overrides.date),
    });

    return id;
  }

  async function seedLedger(): Promise<void> {
    await insertTransaction({ date: '2026-08-20T15:00:00Z', amount: 1000 });
    await insertTransaction({
      date: '2026-09-05T15:00:00Z',
      amount: 400,
      accountId: checkingId,
      destinationAccountId: cardId,
      type: TransactionType.TRANSFER,
    });
    await insertTransaction({ date: '2026-09-11T02:00:00Z', amount: 50 });
    await insertTransaction({ date: '2026-09-20T15:00:00Z', amount: 600 });
    await insertTransaction({
      date: '2026-09-22T15:00:00Z',
      amount: 150,
      type: TransactionType.INCOME,
    });
    await insertTransaction({
      date: '2026-09-25T15:00:00Z',
      amount: 250,
      accountId: otherCardId,
      destinationAccountId: cardId,
      type: TransactionType.TRANSFER,
    });
    await insertTransaction({
      date: '2026-10-12T15:00:00Z',
      amount: 300,
      accountId: checkingId,
      destinationAccountId: cardId,
      type: TransactionType.TRANSFER,
    });
    await insertTransaction({ date: '2026-10-25T15:00:00Z', amount: 900 });
    await insertTransaction({
      date: '2026-10-05T15:00:00Z',
      amount: 700,
      status: TransactionStatus.PENDING,
    });
    await insertTransaction({
      date: '2026-09-15T15:00:00Z',
      amount: 5000,
      workspaceId: otherWorkspaceId,
    });
  }

  async function statementEntriesOf(
    accountId: string,
  ): Promise<StatementEntry[]> {
    const rows = await db
      .select()
      .from(schema.transactions)
      .where(
        sql`${schema.transactions.workspaceId} = ${workspaceId} AND ${schema.transactions.status} = ${TransactionStatus.COMPLETED} AND (${schema.transactions.accountId} = ${accountId} OR ${schema.transactions.destinationAccountId} = ${accountId})`,
      );

    return rows.map((row) => ({
      date: dateProvider.format(row.date, 'YYYY-MM-DD', TIMEZONE),
      amount: BigInt(row.amount),
      kind:
        row.destinationAccountId === accountId ||
        row.type === TransactionType.INCOME
          ? 'payment'
          : 'charge',
    }));
  }

  it('matches buildInvoiceStatement for every card of the call', async () => {
    await seedLedger();

    const [cardTotals, otherCardTotals] = await repository.findTotals(
      workspaceId,
      [windowOf(cardId), windowOf(otherCardId)],
    );

    for (const [accountId, totals] of [
      [cardId, cardTotals],
      [otherCardId, otherCardTotals],
    ] as const) {
      expect(buildInvoiceStatementFromTotals(totals)).toEqual(
        buildInvoiceStatement({
          calendar,
          key: KEY,
          today: TODAY,
          entries: await statementEntriesOf(accountId),
        }),
      );
    }
  });

  it('sums each bucket in cents', async () => {
    await seedLedger();

    const [totals] = await repository.findTotals(workspaceId, [
      windowOf(cardId),
    ]);

    expect(totals).toEqual({
      chargesBeforePeriod: 1050n,
      paymentsBeforePeriod: 400n,
      chargesInPeriod: 600n,
      paymentsInPeriod: 400n,
      paymentsAfterClosing: 300n,
      pendingCharges: 700n,
    });
  });

  it('counts only pending charges of the period as pendingCharges', async () => {
    await insertTransaction({
      date: '2026-10-05T15:00:00Z',
      amount: 700,
      status: TransactionStatus.PENDING,
    });
    await insertTransaction({
      date: '2026-10-06T15:00:00Z',
      amount: 120,
      type: TransactionType.INCOME,
      status: TransactionStatus.PENDING,
    });
    await insertTransaction({
      date: '2026-10-07T15:00:00Z',
      amount: 330,
      accountId: checkingId,
      destinationAccountId: cardId,
      type: TransactionType.TRANSFER,
      status: TransactionStatus.PENDING,
    });

    const [totals] = await repository.findTotals(workspaceId, [
      windowOf(cardId),
    ]);

    expect(totals.pendingCharges).toBe(700n);
  });

  it('returns zeros for a card without transactions', async () => {
    const [totals] = await repository.findTotals(workspaceId, [
      windowOf(cardId),
    ]);

    expect(totals).toEqual({
      chargesBeforePeriod: 0n,
      paymentsBeforePeriod: 0n,
      chargesInPeriod: 0n,
      paymentsInPeriod: 0n,
      paymentsAfterClosing: 0n,
      pendingCharges: 0n,
    });
  });

  it('does not query when there are no windows', async () => {
    expect(await repository.findTotals(workspaceId, [])).toEqual([]);
  });

  it('lists only the transactions dated inside the period of the workspace', async () => {
    await seedLedger();

    const transactions = await repository.findPeriodTransactions(
      workspaceId,
      windowOf(cardId),
    );

    expect(transactions.map(({ amount }) => amount)).toEqual([
      700n,
      250n,
      150n,
      600n,
    ]);
  });
});
