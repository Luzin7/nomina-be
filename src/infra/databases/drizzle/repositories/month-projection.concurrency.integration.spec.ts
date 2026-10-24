import {
  AccountType,
  RecurrenceFrequency,
  TransactionStatus,
  TransactionType,
} from '@constants/enums';
import { DEFAULT_TIMEZONE } from '@constants/timezone';
import { DrizzleService } from '@infra/databases/drizzle/drizzle.service';
import * as schema from '@infra/databases/drizzle/schema';
import { SYSTEM_CATEGORY } from '@modules/category/constants/system-categories';
import { DateRange } from '@modules/report/repositories/contracts/MonthProjectionRepository';
import { DayJsDateProvider } from '@providers/date/implementations/Dayjs';
import { nextOccurrence } from '@utils/installmentSchedule';
import {
  PostgreSqlContainer,
  StartedPostgreSqlContainer,
} from '@testcontainers/postgresql';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import postgres from 'postgres';
import { MonthProjectionRepositoryImplementation } from './month-projection.repository';

type TransactionRow = typeof schema.transactions.$inferInsert;
type RecurringRow = typeof schema.recurringTransactions.$inferInsert;

const MIGRATIONS_FOLDER = resolve(__dirname, '../../../../../drizzle');
const dateProvider = new DayJsDateProvider();

const monthRange = (reference: string): DateRange => ({
  start: dateProvider.startOfMonth(reference, DEFAULT_TIMEZONE),
  end: dateProvider.endOfMonth(reference, DEFAULT_TIMEZONE),
});

const MARCH = monthRange('2026-03-15');
const IN_MARCH = new Date('2026-03-05T15:00:00Z');
const LEDGER_RANGE: DateRange = {
  start: monthRange('2025-10-15').start,
  end: monthRange('2026-10-15').end,
};
const CURRENT_MONTH_START = monthRange('2026-10-15').start;
const IN_SEPTEMBER = new Date('2026-09-10T15:00:00Z');
const IN_OCTOBER = new Date('2026-10-10T15:00:00Z');

jest.setTimeout(180_000);

async function matchProductionDateColumn(client: postgres.Sql) {
  await client`
    ALTER TABLE transactions
    ALTER COLUMN date TYPE timestamp without time zone
    USING date AT TIME ZONE 'UTC'`;
}

describe('month projection repository against a real postgres', () => {
  let container: StartedPostgreSqlContainer;
  let queryClient: postgres.Sql;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  let repository: MonthProjectionRepositoryImplementation;

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
    await matchProductionDateColumn(queryClient);
    repository = new MonthProjectionRepositoryImplementation({
      db,
    } as unknown as DrizzleService);
  });

  afterAll(async () => {
    await queryClient.end({ timeout: 5 });
    await container.stop();
  });

  async function seedWorkspace() {
    const workspaceId = randomUUID();
    const accountId = randomUUID();
    const categoryId = randomUUID();
    const legacyOthersCategoryId = randomUUID();

    await db.insert(schema.workspaces).values({ id: workspaceId, name: 'WS' });
    await db.insert(schema.accounts).values({
      id: accountId,
      workspaceId,
      name: 'Account',
      type: AccountType.CHECKING,
    });
    await db.insert(schema.categories).values([
      {
        id: categoryId,
        workspaceId,
        name: 'Category',
        type: TransactionType.EXPENSE,
      },
      {
        id: legacyOthersCategoryId,
        workspaceId,
        name: 'Outros Gastos',
        type: TransactionType.EXPENSE,
        isSystemCategory: true,
      },
    ]);

    return { workspaceId, accountId, categoryId, legacyOthersCategoryId };
  }

  function makeRow(
    overrides: Partial<TransactionRow> &
      Pick<TransactionRow, 'workspaceId' | 'accountId' | 'categoryId'>,
  ): TransactionRow {
    return {
      id: randomUUID(),
      title: 'Transaction',
      amount: 1_000,
      date: IN_MARCH,
      type: TransactionType.EXPENSE,
      status: TransactionStatus.COMPLETED,
      ...overrides,
    };
  }

  function makeRule(
    overrides: Partial<RecurringRow> &
      Pick<RecurringRow, 'workspaceId' | 'accountId' | 'categoryId'>,
  ): RecurringRow {
    return {
      id: randomUUID(),
      title: 'Rule',
      amount: 5_000,
      type: TransactionType.EXPENSE,
      frequency: RecurrenceFrequency.MONTHLY,
      interval: 1,
      startDate: new Date('2026-02-10T15:00:00Z'),
      ...overrides,
    };
  }

  function findLedger(workspaceId: string) {
    return repository.findMonthLedger({
      workspaceId,
      timezone: DEFAULT_TIMEZONE,
      range: LEDGER_RANGE,
      currentMonthStart: CURRENT_MONTH_START,
    });
  }

  describe('findMonthLedger', () => {
    it('should return an empty ledger for a workspace without rows', async () => {
      const ws = await seedWorkspace();

      const ledger = await findLedger(ws.workspaceId);

      expect(ledger).toEqual([]);
    });

    it('should run against a date column without time zone storing UTC instants', async () => {
      const [column] = await queryClient`
        SELECT data_type FROM information_schema.columns
        WHERE table_name = 'transactions' AND column_name = 'date'`;

      expect(column.data_type).toBe('timestamp without time zone');
    });

    it('should put boundary instants in their local month and day', async () => {
      const ws = await seedWorkspace();
      await db.insert(schema.transactions).values([
        makeRow({
          ...ws,
          date: new Date('2026-10-01T02:30:00Z'),
          amount: 100,
        }),
        makeRow({
          ...ws,
          date: new Date('2026-10-01T03:00:00Z'),
          amount: 200,
        }),
      ]);

      const ledger = await findLedger(ws.workspaceId);

      expect(ledger).toHaveLength(2);
      expect(ledger).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            key: '2026-09',
            plainExpenses: [
              {
                day: 30,
                categoryId: ws.categoryId,
                amount: 100,
                pending: false,
              },
            ],
          }),
          expect.objectContaining({
            key: '2026-10',
            plainExpenses: [
              {
                day: 1,
                categoryId: ws.categoryId,
                amount: 200,
                pending: false,
              },
            ],
          }),
        ]),
      );
    });

    it('should leave recurring, installment and system rows out of plain expenses but in the total', async () => {
      const ws = await seedWorkspace();
      const rule = makeRule(ws);
      await db.insert(schema.recurringTransactions).values(rule);
      await db.insert(schema.transactions).values([
        makeRow({ ...ws, date: IN_SEPTEMBER, amount: 1_000 }),
        makeRow({
          ...ws,
          date: IN_SEPTEMBER,
          amount: 2_000,
          recurringId: rule.id,
        }),
        makeRow({
          ...ws,
          date: IN_SEPTEMBER,
          amount: 3_000,
          installmentGroupId: randomUUID(),
        }),
        makeRow({
          ...ws,
          date: IN_SEPTEMBER,
          amount: 4_000,
          categoryId: SYSTEM_CATEGORY.CREDIT_CARD_PAYMENT.id,
        }),
        makeRow({
          ...ws,
          date: IN_SEPTEMBER,
          amount: 5_000,
          categoryId: ws.legacyOthersCategoryId,
        }),
      ]);

      const [september] = await findLedger(ws.workspaceId);

      expect(september.totalExpense).toBe(15_000);
      expect(september.plainExpenses).toHaveLength(2);
      expect(september.plainExpenses).toEqual(
        expect.arrayContaining([
          { day: 10, categoryId: ws.categoryId, amount: 1_000, pending: false },
          {
            day: 10,
            categoryId: ws.legacyOthersCategoryId,
            amount: 5_000,
            pending: false,
          },
        ]),
      );
    });

    it('should keep pending plain rows only for the current month', async () => {
      const ws = await seedWorkspace();
      await db.insert(schema.transactions).values([
        makeRow({ ...ws, date: IN_SEPTEMBER, amount: 1_000 }),
        makeRow({
          ...ws,
          date: IN_SEPTEMBER,
          amount: 2_000,
          status: TransactionStatus.PENDING,
        }),
        makeRow({
          ...ws,
          date: IN_OCTOBER,
          amount: 3_000,
          status: TransactionStatus.PENDING,
        }),
      ]);

      const ledger = await findLedger(ws.workspaceId);

      expect(ledger).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            key: '2026-09',
            plainExpenses: [
              {
                day: 10,
                categoryId: ws.categoryId,
                amount: 1_000,
                pending: false,
              },
            ],
          }),
          expect.objectContaining({
            key: '2026-10',
            plainExpenses: [
              {
                day: 10,
                categoryId: ws.categoryId,
                amount: 3_000,
                pending: true,
              },
            ],
          }),
        ]),
      );
    });

    it('should total completed expense and pending by type per month', async () => {
      const ws = await seedWorkspace();
      await db.insert(schema.transactions).values([
        makeRow({ ...ws, date: IN_OCTOBER, amount: 1_000 }),
        makeRow({ ...ws, date: IN_OCTOBER, amount: 500 }),
        makeRow({
          ...ws,
          date: IN_OCTOBER,
          amount: 9_000,
          type: TransactionType.INCOME,
        }),
        makeRow({
          ...ws,
          date: IN_OCTOBER,
          amount: 2_000,
          status: TransactionStatus.PENDING,
        }),
        makeRow({
          ...ws,
          date: IN_OCTOBER,
          amount: 7_000,
          type: TransactionType.INCOME,
          status: TransactionStatus.PENDING,
        }),
      ]);

      const [october] = await findLedger(ws.workspaceId);

      expect(october.key).toBe('2026-10');
      expect(october.totalExpense).toBe(1_500);
      expect(october.pending).toEqual({
        totalIncome: 7_000,
        totalExpense: 2_000,
      });
    });

    it('should omit months without rows', async () => {
      const ws = await seedWorkspace();
      await db
        .insert(schema.transactions)
        .values([
          makeRow({ ...ws, date: IN_SEPTEMBER }),
          makeRow({ ...ws, date: new Date('2026-07-10T15:00:00Z') }),
        ]);

      const ledger = await findLedger(ws.workspaceId);

      expect(
        ledger.map((month) => month.key).sort((a, b) => a.localeCompare(b)),
      ).toEqual(['2026-07', '2026-09']);
    });

    it('should isolate another workspace', async () => {
      const ws = await seedWorkspace();
      const foreign = await seedWorkspace();
      await db
        .insert(schema.transactions)
        .values([
          makeRow({ ...ws, date: IN_SEPTEMBER, amount: 100 }),
          makeRow({ ...foreign, date: IN_SEPTEMBER, amount: 222 }),
          makeRow({ ...foreign, date: IN_OCTOBER, amount: 333 }),
        ]);

      const ledger = await findLedger(ws.workspaceId);

      expect(ledger).toHaveLength(1);
      expect(ledger[0].totalExpense).toBe(100);
    });
  });

  describe('findActiveRecurringRules', () => {
    it('should return only active income and expense rules that overlap the month', async () => {
      const ws = await seedWorkspace();
      const active = makeRule(ws);
      const income = makeRule({ ...ws, type: TransactionType.INCOME });
      const openEnded = makeRule({ ...ws, endDate: null });
      const endsOnMonthStart = makeRule({ ...ws, endDate: MARCH.start });
      await db
        .insert(schema.recurringTransactions)
        .values([
          active,
          income,
          openEnded,
          endsOnMonthStart,
          makeRule({ ...ws, active: false }),
          makeRule({ ...ws, type: TransactionType.TRANSFER }),
          makeRule({ ...ws, endDate: new Date(MARCH.start.getTime() - 1) }),
          makeRule({ ...ws, startDate: new Date(MARCH.end.getTime() + 1) }),
        ]);

      const rules = await repository.findActiveRecurringRules(
        ws.workspaceId,
        MARCH,
      );

      const ids = rules.map((rule) => rule.id);
      expect(ids).toHaveLength(4);
      expect(ids).toEqual(
        expect.arrayContaining([
          active.id,
          income.id,
          openEnded.id,
          endsOnMonthStart.id,
        ]),
      );
    });

    it('should map the rule snapshot fields', async () => {
      const ws = await seedWorkspace();
      const lastGenerated = new Date('2026-02-10T15:00:00Z');
      const rule = makeRule({
        ...ws,
        interval: 2,
        endDate: new Date('2026-12-10T15:00:00Z'),
        lastGenerated,
      });
      await db.insert(schema.recurringTransactions).values(rule);

      const [snapshot] = await repository.findActiveRecurringRules(
        ws.workspaceId,
        MARCH,
      );

      expect(snapshot).toEqual({
        id: rule.id,
        type: TransactionType.EXPENSE,
        amount: 5_000,
        frequency: RecurrenceFrequency.MONTHLY,
        interval: 2,
        startDate: rule.startDate,
        endDate: rule.endDate,
        lastGenerated,
        materializedDates: [],
      });
    });

    it('should limit materializedDates to the month and match nextOccurrence', async () => {
      const ws = await seedWorkspace();
      const rule = makeRule(ws);
      const schedule = {
        frequency: RecurrenceFrequency.MONTHLY,
        interval: 1,
        timezone: DEFAULT_TIMEZONE,
      };
      const february = rule.startDate;
      const march = nextOccurrence(
        { ...schedule, startDate: february },
        dateProvider,
      );
      const april = nextOccurrence(
        { ...schedule, startDate: march },
        dateProvider,
      );
      await db.insert(schema.recurringTransactions).values(rule);
      await db.insert(schema.transactions).values(
        [february, march, april].map((date, index) =>
          makeRow({
            ...ws,
            recurringId: rule.id,
            date,
            status:
              index === 1
                ? TransactionStatus.PENDING
                : TransactionStatus.COMPLETED,
          }),
        ),
      );

      const [snapshot] = await repository.findActiveRecurringRules(
        ws.workspaceId,
        MARCH,
      );

      expect(snapshot.materializedDates.map((date) => date.getTime())).toEqual([
        march.getTime(),
      ]);
    });

    it('should isolate another workspace', async () => {
      const ws = await seedWorkspace();
      const foreign = await seedWorkspace();
      await db.insert(schema.recurringTransactions).values(makeRule(foreign));

      const rules = await repository.findActiveRecurringRules(
        ws.workspaceId,
        MARCH,
      );

      expect(rules).toEqual([]);
    });
  });
});
