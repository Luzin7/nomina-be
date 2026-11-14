import {
  AccountType,
  RecurrenceFrequency,
  TransactionType,
} from '@constants/enums';
import { DEFAULT_TIMEZONE } from '@constants/timezone';
import { DrizzleService } from '@infra/databases/drizzle/drizzle.service';
import * as schema from '@infra/databases/drizzle/schema';
import { DayJsDateProvider } from '@providers/date/implementations/Dayjs';
import {
  PostgreSqlContainer,
  StartedPostgreSqlContainer,
} from '@testcontainers/postgresql';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import postgres from 'postgres';
import { RecurringTransactionRepositoryImplementation } from './recurring-transaction.repository';

type RecurringRow = typeof schema.recurringTransactions.$inferInsert;

const MIGRATIONS_FOLDER = resolve(__dirname, '../../../../../drizzle');
const LISBON = 'Europe/Lisbon';
const dateProvider = new DayJsDateProvider();

jest.setTimeout(180_000);

const localMidnight = (localDate: string, timezone: string): Date =>
  dateProvider.startOfDay(localDate, timezone);

describe('recurring summary exhaustion against a real postgres', () => {
  let container: StartedPostgreSqlContainer;
  let queryClient: postgres.Sql;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  let repository: RecurringTransactionRepositoryImplementation;

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
    repository = new RecurringTransactionRepositoryImplementation({
      db,
    } as unknown as DrizzleService);
  });

  afterAll(async () => {
    await queryClient?.end({ timeout: 5 });
    await container?.stop();
  });

  function makeRule(
    overrides: Partial<RecurringRow> &
      Pick<RecurringRow, 'workspaceId' | 'accountId' | 'categoryId'>,
  ): RecurringRow {
    return {
      id: randomUUID(),
      title: 'Rule',
      amount: 1_000,
      type: TransactionType.EXPENSE,
      frequency: RecurrenceFrequency.MONTHLY,
      interval: 1,
      startDate: localMidnight('2026-01-10', DEFAULT_TIMEZONE),
      ...overrides,
    };
  }

  async function seedRules(rows: Partial<RecurringRow>[]) {
    const workspaceId = randomUUID();
    const accountId = randomUUID();
    const categoryId = randomUUID();
    await db.insert(schema.workspaces).values({ id: workspaceId, name: 'WS' });
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

    const rules = rows.map((overrides) =>
      makeRule({ ...overrides, workspaceId, accountId, categoryId }),
    );
    await db.insert(schema.recurringTransactions).values(rules);

    return { workspaceId };
  }

  async function isExhausted(
    workspaceId: string,
    localDate: string,
    timezone: string,
  ) {
    const [row] = await repository.findSummaryRules({
      workspaceId,
      todayStart: localMidnight(localDate, timezone),
      timezone,
    });

    return row.exhausted;
  }

  it('should keep a three installment monthly plan active until its last parcel day', async () => {
    const { workspaceId } = await seedRules([
      { installmentCount: 3, endDate: null },
    ]);

    expect(await isExhausted(workspaceId, '2026-03-09', DEFAULT_TIMEZONE)).toBe(
      false,
    );
    expect(await isExhausted(workspaceId, '2026-03-10', DEFAULT_TIMEZONE)).toBe(
      true,
    );
  });

  it('should never exhaust a rule without installment count', async () => {
    const { workspaceId } = await seedRules([
      { installmentCount: null, endDate: null },
    ]);

    expect(await isExhausted(workspaceId, '2026-03-10', DEFAULT_TIMEZONE)).toBe(
      false,
    );
    expect(await isExhausted(workspaceId, '2030-01-01', DEFAULT_TIMEZONE)).toBe(
      false,
    );
  });

  it('should exhaust a two week interval plan on its boundary day', async () => {
    const { workspaceId } = await seedRules([
      {
        frequency: RecurrenceFrequency.WEEKLY,
        interval: 2,
        installmentCount: 3,
        endDate: null,
      },
    ]);

    expect(await isExhausted(workspaceId, '2026-02-06', DEFAULT_TIMEZONE)).toBe(
      false,
    );
    expect(await isExhausted(workspaceId, '2026-02-07', DEFAULT_TIMEZONE)).toBe(
      true,
    );
  });

  it('should read the last parcel day in the workspace timezone', async () => {
    const { workspaceId } = await seedRules([
      {
        installmentCount: 3,
        endDate: null,
        startDate: localMidnight('2026-03-01', LISBON),
      },
    ]);

    expect(await isExhausted(workspaceId, '2026-04-28', LISBON)).toBe(false);
    expect(await isExhausted(workspaceId, '2026-04-29', LISBON)).toBe(false);
    expect(await isExhausted(workspaceId, '2026-05-01', LISBON)).toBe(true);
  });
});
