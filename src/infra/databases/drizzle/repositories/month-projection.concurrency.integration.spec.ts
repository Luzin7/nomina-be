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

const dayRange = (reference: string): DateRange => ({
  start: dateProvider.startOfDay(reference, DEFAULT_TIMEZONE),
  end: dateProvider.endOfDay(reference, DEFAULT_TIMEZONE),
});

const MARCH = monthRange('2026-03-15');
const FEBRUARY = monthRange('2026-02-15');
const JANUARY = monthRange('2026-01-15');
const TODAY = dayRange('2026-03-10');
const IN_MARCH = new Date('2026-03-05T15:00:00Z');
const IN_FEBRUARY = new Date('2026-02-05T15:00:00Z');
const TODAY_NOON = new Date('2026-03-10T15:00:00Z');

jest.setTimeout(180_000);

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

  function sumTotals(workspaceId: string) {
    return repository.sumProjectionTotals({
      workspaceId,
      currentMonth: MARCH,
      today: TODAY,
      basisMonths: [FEBRUARY, JANUARY],
    });
  }

  describe('sumProjectionTotals', () => {
    it('should exclude transfers and invoice payments from every total', async () => {
      const ws = await seedWorkspace();
      await db.insert(schema.transactions).values([
        makeRow({
          ...ws,
          categoryId: SYSTEM_CATEGORY.TRANSFER.id,
          type: TransactionType.TRANSFER,
          date: TODAY_NOON,
        }),
        makeRow({
          ...ws,
          categoryId: SYSTEM_CATEGORY.TRANSFER.id,
          type: TransactionType.TRANSFER,
          status: TransactionStatus.PENDING,
        }),
        makeRow({
          ...ws,
          categoryId: SYSTEM_CATEGORY.CREDIT_CARD_PAYMENT.id,
          type: TransactionType.TRANSFER,
          date: IN_FEBRUARY,
        }),
      ]);

      const totals = await sumTotals(ws.workspaceId);

      expect(totals).toEqual({
        scheduled: { totalIncome: 0, totalExpense: 0 },
        variableExpenseToday: 0,
        basisMonths: [
          { totalExpense: 0, variableExpense: 0 },
          { totalExpense: 0, variableExpense: 0 },
        ],
        firstActivityAt: null,
      });
    });

    it('should split pending by type across the whole month', async () => {
      const ws = await seedWorkspace();
      await db.insert(schema.transactions).values([
        makeRow({
          ...ws,
          status: TransactionStatus.PENDING,
          type: TransactionType.INCOME,
          amount: 7_000,
          date: new Date('2026-03-01T04:00:00Z'),
        }),
        makeRow({
          ...ws,
          status: TransactionStatus.PENDING,
          amount: 2_000,
          date: new Date('2026-03-31T02:00:00Z'),
        }),
        makeRow({ ...ws, status: TransactionStatus.PENDING, amount: 300 }),
        makeRow({ ...ws, amount: 9_999 }),
      ]);

      const { scheduled } = await sumTotals(ws.workspaceId);

      expect(scheduled).toEqual({
        totalIncome: 7_000,
        totalExpense: 2_300,
      });
    });

    it('should count a boundary instant inside its local month and leave the neighbours out', async () => {
      const ws = await seedWorkspace();
      await db.insert(schema.transactions).values([
        makeRow({ ...ws, date: MARCH.start, amount: 1 }),
        makeRow({ ...ws, date: MARCH.end, amount: 10 }),
        makeRow({
          ...ws,
          date: new Date(MARCH.start.getTime() - 1),
          amount: 100,
        }),
        makeRow({
          ...ws,
          date: new Date(MARCH.end.getTime() + 1),
          amount: 1_000,
        }),
      ]);

      const totals = await sumTotals(ws.workspaceId);

      expect(totals.basisMonths).toEqual([
        { totalExpense: 100, variableExpense: 100 },
        { totalExpense: 0, variableExpense: 0 },
      ]);
    });

    it('should count a completed variable expense of today only', async () => {
      const ws = await seedWorkspace();
      await db.insert(schema.transactions).values([
        makeRow({ ...ws, date: TODAY_NOON, amount: 400 }),
        makeRow({ ...ws, date: IN_MARCH, amount: 50 }),
        makeRow({
          ...ws,
          date: TODAY_NOON,
          status: TransactionStatus.PENDING,
          amount: 60,
        }),
        makeRow({
          ...ws,
          date: TODAY_NOON,
          type: TransactionType.INCOME,
          amount: 70,
        }),
      ]);

      const totals = await sumTotals(ws.workspaceId);

      expect(totals.variableExpenseToday).toBe(400);
    });

    it('should leave recurring and installment rows out of variable', async () => {
      const ws = await seedWorkspace();
      const rule = makeRule(ws);
      await db.insert(schema.recurringTransactions).values(rule);
      await db.insert(schema.transactions).values([
        makeRow({
          ...ws,
          recurringId: rule.id,
          date: TODAY_NOON,
          amount: 100,
        }),
        makeRow({
          ...ws,
          installmentGroupId: randomUUID(),
          date: TODAY_NOON,
          amount: 200,
        }),
        makeRow({
          ...ws,
          recurringId: rule.id,
          date: IN_FEBRUARY,
          amount: 300,
        }),
        makeRow({
          ...ws,
          installmentGroupId: randomUUID(),
          date: new Date('2026-02-06T15:00:00Z'),
          amount: 400,
        }),
        makeRow({
          ...ws,
          date: new Date('2026-02-07T15:00:00Z'),
          amount: 500,
        }),
      ]);

      const totals = await sumTotals(ws.workspaceId);

      expect(totals.variableExpenseToday).toBe(0);
      expect(totals.basisMonths[0]).toEqual({
        totalExpense: 1_200,
        variableExpense: 500,
      });
    });

    it('should count a card payment expense in the total but not in variable', async () => {
      const ws = await seedWorkspace();
      await db.insert(schema.transactions).values([
        makeRow({
          ...ws,
          categoryId: SYSTEM_CATEGORY.CREDIT_CARD_PAYMENT.id,
          date: IN_FEBRUARY,
          amount: 800,
        }),
        makeRow({
          ...ws,
          categoryId: SYSTEM_CATEGORY.CREDIT_CARD_PAYMENT.id,
          date: TODAY_NOON,
          amount: 900,
        }),
      ]);

      const totals = await sumTotals(ws.workspaceId);

      expect(totals.basisMonths[0]).toEqual({
        totalExpense: 800,
        variableExpense: 0,
      });
      expect(totals.variableExpenseToday).toBe(0);
    });

    it('should count a legacy system-flagged Outros Gastos expense as variable', async () => {
      const ws = await seedWorkspace();
      await db.insert(schema.transactions).values([
        makeRow({
          ...ws,
          categoryId: ws.legacyOthersCategoryId,
          date: IN_FEBRUARY,
          amount: 600,
        }),
        makeRow({
          ...ws,
          categoryId: ws.legacyOthersCategoryId,
          date: TODAY_NOON,
          amount: 650,
        }),
      ]);

      const totals = await sumTotals(ws.workspaceId);

      expect(totals.basisMonths[0]).toEqual({
        totalExpense: 600,
        variableExpense: 600,
      });
      expect(totals.variableExpenseToday).toBe(650);
    });

    it('should report the first completed income or expense as firstActivityAt', async () => {
      const ws = await seedWorkspace();
      const first = new Date('2025-11-03T15:00:00Z');
      await db.insert(schema.transactions).values([
        makeRow({ ...ws, date: first }),
        makeRow({ ...ws, date: IN_MARCH }),
        makeRow({
          ...ws,
          date: new Date('2025-09-01T15:00:00Z'),
          status: TransactionStatus.PENDING,
        }),
        makeRow({
          ...ws,
          date: new Date('2025-08-01T15:00:00Z'),
          categoryId: SYSTEM_CATEGORY.TRANSFER.id,
          type: TransactionType.TRANSFER,
        }),
      ]);

      const totals = await sumTotals(ws.workspaceId);

      expect(totals.firstActivityAt?.getTime()).toBe(first.getTime());
    });

    it('should isolate another workspace', async () => {
      const ws = await seedWorkspace();
      const foreign = await seedWorkspace();
      await db.insert(schema.transactions).values([
        makeRow({ ...foreign, date: TODAY_NOON, amount: 111 }),
        makeRow({ ...foreign, date: IN_FEBRUARY, amount: 222 }),
        makeRow({
          ...foreign,
          status: TransactionStatus.PENDING,
          amount: 333,
        }),
      ]);

      const totals = await sumTotals(ws.workspaceId);

      expect(totals.variableExpenseToday).toBe(0);
      expect(totals.scheduled.totalExpense).toBe(0);
      expect(totals.basisMonths[0].totalExpense).toBe(0);
      expect(totals.firstActivityAt).toBeNull();
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
