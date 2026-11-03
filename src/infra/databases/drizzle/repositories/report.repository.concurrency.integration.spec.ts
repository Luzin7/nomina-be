import {
  AccountType,
  TransactionStatus,
  TransactionType,
} from '@constants/enums';
import { DEFAULT_TIMEZONE } from '@constants/timezone';
import { DrizzleService } from '@infra/databases/drizzle/drizzle.service';
import * as schema from '@infra/databases/drizzle/schema';
import {
  SummaryMetrics,
  SummaryRanges,
} from '@modules/report/repositories/contracts/ReportRepository';
import { DayJsDateProvider } from '@providers/date/implementations/Dayjs';
import {
  PostgreSqlContainer,
  StartedPostgreSqlContainer,
} from '@testcontainers/postgresql';
import { and, eq, gte, lte, sql, sum } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import postgres from 'postgres';
import { ReportRepositoryImplementation } from './report.repository';

type Database = ReturnType<typeof drizzle<typeof schema>>;
type TransactionInsert = typeof schema.transactions.$inferInsert;
type SeededWorkspace = {
  workspaceId: string;
  accountId: string;
  categoryId: string;
};
type FixtureRow = {
  wallClock: string;
  type: TransactionType;
  amount: number;
  status?: TransactionStatus;
};

const MIGRATIONS_FOLDER = resolve(__dirname, '../../../../../drizzle');

const dateProvider = new DayJsDateProvider();
const NOW = new Date('2026-10-23T15:00:00.000Z');
const WORKSPACE_TIMEZONE = DEFAULT_TIMEZONE;

const currentStart = dateProvider.startOfMonth(NOW, WORKSPACE_TIMEZONE);
const currentEnd = dateProvider.endOfMonth(NOW, WORKSPACE_TIMEZONE);
const previousReference = dateProvider.add(
  currentStart,
  -1,
  'month',
  WORKSPACE_TIMEZONE,
);
const prevStart = dateProvider.startOfMonth(
  previousReference,
  WORKSPACE_TIMEZONE,
);
const prevEnd = dateProvider.endOfMonth(previousReference, WORKSPACE_TIMEZONE);
const prevMtdEnd = dateProvider.endOfDay(
  dateProvider.add(prevStart, 22, 'day', WORKSPACE_TIMEZONE),
  WORKSPACE_TIMEZONE,
);

const RANGES: SummaryRanges = {
  currentStart,
  currentEnd,
  prevStart,
  prevEnd,
  prevMtdEnd,
};

const EXPECTED_METRICS: SummaryMetrics = {
  currentMonthData: { totalIncome: 3_750, totalExpense: 800 },
  previousMonthData: { totalIncome: 1_221, totalExpense: 2_502 },
  previousMonthToDateData: { totalIncome: 444, totalExpense: 797 },
};

// Wall-clock values in the naive production shape; boundary rows are
// re-asserted individually below.
const FIXTURE_ROWS: FixtureRow[] = [
  {
    wallClock: '2026-09-01 02:59:59',
    type: TransactionType.INCOME,
    amount: 444,
  },
  {
    wallClock: '2026-09-01 03:00:00',
    type: TransactionType.INCOME,
    amount: 333,
  },
  {
    wallClock: '2026-09-10 03:00:00',
    type: TransactionType.INCOME,
    amount: 111,
  },
  {
    wallClock: '2026-09-15 03:00:00',
    type: TransactionType.EXPENSE,
    amount: 222,
  },
  {
    wallClock: '2026-09-20 03:00:00',
    type: TransactionType.EXPENSE,
    amount: 555,
  },
  {
    wallClock: '2026-09-24 02:59:59',
    type: TransactionType.EXPENSE,
    amount: 20,
  },
  {
    wallClock: '2026-09-24 03:00:00',
    type: TransactionType.EXPENSE,
    amount: 40,
  },
  {
    wallClock: '2026-09-25 03:00:00',
    type: TransactionType.EXPENSE,
    amount: 666,
  },
  {
    wallClock: '2026-09-30 03:00:00',
    type: TransactionType.INCOME,
    amount: 777,
  },
  {
    wallClock: '2026-10-01 02:59:59',
    type: TransactionType.EXPENSE,
    amount: 999,
  },
  {
    wallClock: '2026-10-01 03:00:00',
    type: TransactionType.INCOME,
    amount: 50,
  },
  {
    wallClock: '2026-10-05 03:00:00',
    type: TransactionType.INCOME,
    amount: 1_000,
  },
  {
    wallClock: '2026-10-06 03:00:00',
    type: TransactionType.EXPENSE,
    amount: 5_000,
    status: TransactionStatus.PENDING,
  },
  {
    wallClock: '2026-10-10 03:00:00',
    type: TransactionType.EXPENSE,
    amount: 300,
  },
  {
    wallClock: '2026-10-20 03:00:00',
    type: TransactionType.INCOME,
    amount: 2_000,
  },
  {
    wallClock: '2026-10-20 03:00:00',
    type: TransactionType.EXPENSE,
    amount: 500,
  },
  {
    wallClock: '2026-10-31 03:00:00',
    type: TransactionType.INCOME,
    amount: 700,
  },
];

jest.setTimeout(180_000);

// Mirrors the production column shape. The precedent helper in
// month-projection.concurrency.integration.spec.ts is not exported for reuse.
async function matchProductionDateColumn(client: postgres.Sql) {
  await client`
    ALTER TABLE transactions
    ALTER COLUMN date TYPE timestamp without time zone
    USING date AT TIME ZONE 'UTC'`;
}

// ISO text is stored as its wall clock once postgres drops the trailing Z,
// which is what production holds for a naive column.
function naiveTimestamp(wallClock: string): Date {
  return new Date(`${wallClock.replace(' ', 'T')}.000Z`);
}

describe('report repository month summary against a real postgres', () => {
  let container: StartedPostgreSqlContainer;
  let queryClient: postgres.Sql;
  let utcClient: postgres.Sql;
  let saoPauloClient: postgres.Sql;
  let db: Database;
  let utcDb: Database;
  let saoPauloDb: Database;
  let repository: ReportRepositoryImplementation;
  let saoPauloRepository: ReportRepositoryImplementation;

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:16-alpine')
      .withStartupTimeout(120_000)
      .start();

    queryClient = postgres(container.getConnectionUri(), {
      max: 1,
      onnotice: () => undefined,
      connection: { TimeZone: 'UTC' },
    });
    utcClient = postgres(container.getConnectionUri(), {
      max: 1,
      onnotice: () => undefined,
      connection: { TimeZone: 'UTC' },
    });
    saoPauloClient = postgres(container.getConnectionUri(), {
      max: 1,
      onnotice: () => undefined,
      connection: { TimeZone: 'America/Sao_Paulo' },
    });

    db = drizzle(queryClient, { schema });
    utcDb = drizzle(utcClient, { schema });
    saoPauloDb = drizzle(saoPauloClient, { schema });

    await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
    await matchProductionDateColumn(queryClient);

    repository = new ReportRepositoryImplementation({
      db: utcDb,
    } as unknown as DrizzleService);
    saoPauloRepository = new ReportRepositoryImplementation({
      db: saoPauloDb,
    } as unknown as DrizzleService);
  });

  afterAll(async () => {
    await saoPauloClient.end({ timeout: 5 });
    await utcClient.end({ timeout: 5 });
    await queryClient.end({ timeout: 5 });
    await container.stop();
  });

  beforeEach(async () => {
    await db.execute(
      sql`TRUNCATE workspaces, accounts, categories, transactions RESTART IDENTITY CASCADE`,
    );
  });

  async function seedWorkspace(name: string): Promise<SeededWorkspace> {
    const workspaceId = randomUUID();
    const accountId = randomUUID();
    const categoryId = randomUUID();

    await db.insert(schema.workspaces).values({ id: workspaceId, name });
    await db.insert(schema.accounts).values({
      id: accountId,
      workspaceId,
      name: 'Account',
      type: AccountType.CHECKING,
    });
    await db.insert(schema.categories).values({
      id: categoryId,
      workspaceId,
      name: 'Category',
      type: TransactionType.EXPENSE,
    });

    return { workspaceId, accountId, categoryId };
  }

  async function seedTransactions(
    workspace: SeededWorkspace,
    rows: FixtureRow[],
  ): Promise<void> {
    await db.insert(schema.transactions).values(
      rows.map((row): TransactionInsert => {
        return {
          id: randomUUID(),
          workspaceId: workspace.workspaceId,
          accountId: workspace.accountId,
          categoryId: workspace.categoryId,
          title: `Row ${randomUUID()}`,
          amount: row.amount,
          date: naiveTimestamp(row.wallClock),
          type: row.type,
          status: row.status ?? TransactionStatus.COMPLETED,
        };
      }),
    );
  }

  async function legacyWindowTotals(
    workspaceId: string,
    start: Date,
    end: Date,
  ): Promise<{ totalIncome: number; totalExpense: number }> {
    const rows = await db
      .select({
        type: schema.transactions.type,
        total: sum(schema.transactions.amount).mapWith(Number),
      })
      .from(schema.transactions)
      .where(
        and(
          eq(schema.transactions.workspaceId, workspaceId),
          eq(schema.transactions.status, TransactionStatus.COMPLETED),
          gte(schema.transactions.date, start),
          lte(schema.transactions.date, end),
        ),
      )
      .groupBy(schema.transactions.type);

    let totalIncome = 0;
    let totalExpense = 0;
    for (const row of rows) {
      if (row.type === TransactionType.INCOME) totalIncome += row.total;
      if (row.type === TransactionType.EXPENSE) totalExpense += row.total;
    }

    return { totalIncome, totalExpense };
  }

  async function castIncomeTotal(
    target: Database,
    workspaceId: string,
    start: Date,
    end: Date,
  ): Promise<number> {
    const rows = await target
      .select({
        total: sum(schema.transactions.amount).mapWith(Number),
      })
      .from(schema.transactions)
      .where(
        sql`${schema.transactions.workspaceId} = ${workspaceId}
          AND ${schema.transactions.status} = ${TransactionStatus.COMPLETED}
          AND ${schema.transactions.type} = ${TransactionType.INCOME}
          AND ${schema.transactions.date} >= ${start.toISOString()}::timestamptz
          AND ${schema.transactions.date} <= ${end.toISOString()}::timestamptz`,
      );

    return rows[0]?.total ?? 0;
  }

  it('stores the date column as the naive production shape', async () => {
    const [column] = await queryClient<{ data_type: string }[]>`
      SELECT data_type FROM information_schema.columns
      WHERE table_name = 'transactions' AND column_name = 'date'`;

    expect(column.data_type).toBe('timestamp without time zone');
  });

  it('opens the utc client with its session timezone at UTC', async () => {
    const [row] = await utcClient<{ tz: string }[]>`
      SELECT current_setting('TimeZone') AS tz`;

    expect(row.tz).toBe('UTC');
  });

  it('opens the sao paulo client with its session timezone at America/Sao_Paulo', async () => {
    const [row] = await saoPauloClient<{ tz: string }[]>`
      SELECT current_setting('TimeZone') AS tz`;

    expect(row.tz).toBe('America/Sao_Paulo');
  });

  describe('old vs new equivalence on one fixture', () => {
    it('matches the legacy per-window oracle and the hand-written totals', async () => {
      const workspace = await seedWorkspace('equivalence');
      await seedTransactions(workspace, FIXTURE_ROWS);

      const metrics = await repository.findMonthSummaryMetrics(
        workspace.workspaceId,
        RANGES,
      );
      const saoPauloMetrics = await saoPauloRepository.findMonthSummaryMetrics(
        workspace.workspaceId,
        RANGES,
      );
      const [current, previous, previousToDate] = await Promise.all([
        legacyWindowTotals(
          workspace.workspaceId,
          RANGES.currentStart,
          RANGES.currentEnd,
        ),
        legacyWindowTotals(
          workspace.workspaceId,
          RANGES.prevStart,
          RANGES.prevEnd,
        ),
        legacyWindowTotals(
          workspace.workspaceId,
          RANGES.prevStart,
          RANGES.prevMtdEnd,
        ),
      ]);

      expect(metrics).toEqual(EXPECTED_METRICS);
      expect(saoPauloMetrics).toEqual(EXPECTED_METRICS);
      expect(metrics.currentMonthData).toEqual(current);
      expect(metrics.previousMonthData).toEqual(previous);
      expect(metrics.previousMonthToDateData).toEqual(previousToDate);
    });
  });

  describe('boundary sensitivity', () => {
    it('includes a row at the previous-month start and excludes the row one second earlier', async () => {
      const workspace = await seedWorkspace('previous start boundary');
      await seedTransactions(workspace, [
        {
          wallClock: '2026-09-01 03:00:00',
          type: TransactionType.INCOME,
          amount: 333,
        },
        {
          wallClock: '2026-09-01 02:59:59',
          type: TransactionType.INCOME,
          amount: 444,
        },
      ]);

      const metrics = await repository.findMonthSummaryMetrics(
        workspace.workspaceId,
        RANGES,
      );
      const saoPauloMetrics = await saoPauloRepository.findMonthSummaryMetrics(
        workspace.workspaceId,
        RANGES,
      );

      expect(metrics.previousMonthData).toEqual({
        totalIncome: 333,
        totalExpense: 0,
      });
      expect(saoPauloMetrics.previousMonthData).toEqual({
        totalIncome: 333,
        totalExpense: 0,
      });
      expect(metrics.currentMonthData).toEqual({
        totalIncome: 0,
        totalExpense: 0,
      });
    });

    it('includes the last local day of the current month and excludes the next one', async () => {
      const workspace = await seedWorkspace('current end boundary');
      await seedTransactions(workspace, [
        {
          wallClock: '2026-10-31 03:00:00',
          type: TransactionType.INCOME,
          amount: 700,
        },
        {
          wallClock: '2026-11-01 02:59:59',
          type: TransactionType.INCOME,
          amount: 11,
        },
        {
          wallClock: '2026-11-01 03:00:00',
          type: TransactionType.INCOME,
          amount: 99,
        },
      ]);

      const metrics = await repository.findMonthSummaryMetrics(
        workspace.workspaceId,
        RANGES,
      );
      const saoPauloMetrics = await saoPauloRepository.findMonthSummaryMetrics(
        workspace.workspaceId,
        RANGES,
      );

      expect(metrics.currentMonthData).toEqual({
        totalIncome: 711,
        totalExpense: 0,
      });
      expect(saoPauloMetrics.currentMonthData).toEqual({
        totalIncome: 711,
        totalExpense: 0,
      });
    });

    it('shows the ::timestamptz form agrees with the repository on a UTC session and disagrees on a Sao Paulo session', async () => {
      const workspace = await seedWorkspace('cast semantics');
      await seedTransactions(workspace, FIXTURE_ROWS);

      const metrics = await repository.findMonthSummaryMetrics(
        workspace.workspaceId,
        RANGES,
      );
      const saoPauloMetrics = await saoPauloRepository.findMonthSummaryMetrics(
        workspace.workspaceId,
        RANGES,
      );
      const utcCastTotal = await castIncomeTotal(
        utcDb,
        workspace.workspaceId,
        RANGES.prevStart,
        RANGES.prevEnd,
      );
      const saoPauloCastTotal = await castIncomeTotal(
        saoPauloDb,
        workspace.workspaceId,
        RANGES.prevStart,
        RANGES.prevEnd,
      );

      expect(utcCastTotal).toBe(metrics.previousMonthData.totalIncome);
      expect(saoPauloCastTotal).toBe(1_665);
      expect(saoPauloCastTotal).not.toBe(
        saoPauloMetrics.previousMonthData.totalIncome,
      );
    });
  });

  describe('timezone independence', () => {
    it('returns identical totals with the session timezone at UTC and at America/Sao_Paulo', async () => {
      const workspace = await seedWorkspace('timezone matrix');
      await seedTransactions(workspace, FIXTURE_ROWS);

      const utcMetrics = await repository.findMonthSummaryMetrics(
        workspace.workspaceId,
        RANGES,
      );
      const saoPauloMetrics = await saoPauloRepository.findMonthSummaryMetrics(
        workspace.workspaceId,
        RANGES,
      );

      expect(utcMetrics).toEqual(EXPECTED_METRICS);
      expect(saoPauloMetrics).toEqual(EXPECTED_METRICS);
      expect(saoPauloMetrics).toEqual(utcMetrics);
    });
  });

  describe('workspace isolation and empty state', () => {
    it('does not leak another workspace rows into the totals', async () => {
      const mine = await seedWorkspace('mine');
      const foreign = await seedWorkspace('foreign');
      await seedTransactions(mine, [
        {
          wallClock: '2026-10-05 03:00:00',
          type: TransactionType.INCOME,
          amount: 100,
        },
      ]);
      await seedTransactions(foreign, [
        {
          wallClock: '2026-10-05 03:00:00',
          type: TransactionType.INCOME,
          amount: 999,
        },
        {
          wallClock: '2026-09-10 03:00:00',
          type: TransactionType.EXPENSE,
          amount: 888,
        },
      ]);

      const metrics = await repository.findMonthSummaryMetrics(
        mine.workspaceId,
        RANGES,
      );

      expect(metrics.currentMonthData).toEqual({
        totalIncome: 100,
        totalExpense: 0,
      });
      expect(metrics.previousMonthData).toEqual({
        totalIncome: 0,
        totalExpense: 0,
      });
      expect(metrics.previousMonthToDateData).toEqual({
        totalIncome: 0,
        totalExpense: 0,
      });
    });

    it('returns zeros rather than nulls for a workspace without rows', async () => {
      const workspace = await seedWorkspace('empty');

      const metrics = await repository.findMonthSummaryMetrics(
        workspace.workspaceId,
        RANGES,
      );

      expect(metrics).toEqual({
        currentMonthData: { totalIncome: 0, totalExpense: 0 },
        previousMonthData: { totalIncome: 0, totalExpense: 0 },
        previousMonthToDateData: { totalIncome: 0, totalExpense: 0 },
      });
    });
  });
});
