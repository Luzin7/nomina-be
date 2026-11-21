import {
  AccountType,
  RecurrenceFrequency,
  TransactionType,
} from '@constants/enums';
import { DEFAULT_TIMEZONE } from '@constants/timezone';
import { CacheProvider } from '@infra/cache/contracts/CacheProvider';
import { DrizzleService } from '@infra/databases/drizzle/drizzle.service';
import { RecurringTransactionRepositoryImplementation } from '@infra/databases/drizzle/repositories/recurring-transaction.repository';
import * as schema from '@infra/databases/drizzle/schema';
import { CalculateNextGenerationDateService } from '@modules/transaction/services/calculate-next-generation-date.service';
import { DayJsDateProvider } from '@providers/date/implementations/Dayjs';
import {
  PostgreSqlContainer,
  StartedPostgreSqlContainer,
} from '@testcontainers/postgresql';
import { asc, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import postgres from 'postgres';
import { GenerateRecurringTransactionsJobService } from './generate-recurring-transactions.service';

jest.mock('@sentry/nestjs', () => ({ captureException: jest.fn() }));

type RecurringRow = typeof schema.recurringTransactions.$inferInsert;

const MIGRATIONS_FOLDER = resolve(__dirname, '../../../../../drizzle');

jest.setTimeout(180_000);

class MutableNowDateProvider extends DayJsDateProvider {
  private current = new Date('2026-04-20T12:00:00.000Z');

  now(): Date {
    return this.current;
  }

  setNow(isoInstant: string): void {
    this.current = new Date(isoInstant);
  }
}

function makeCache(): CacheProvider {
  return {
    isEnabled: false,
    exists: jest.fn().mockResolvedValue(false),
    set: jest.fn().mockResolvedValue(true),
    acquireLock: jest
      .fn()
      .mockResolvedValue({ key: 'lock:recurring', token: 'token' }),
    releaseLock: jest.fn().mockResolvedValue(true),
    incrementCounter: jest.fn().mockResolvedValue(1),
  } as unknown as CacheProvider;
}

describe('recurring generation against a real postgres', () => {
  let container: StartedPostgreSqlContainer;
  let queryClient: postgres.Sql;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  let dateProvider: MutableNowDateProvider;
  let service: GenerateRecurringTransactionsJobService;

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

    dateProvider = new MutableNowDateProvider();
    const repository = new RecurringTransactionRepositoryImplementation({
      db,
    } as unknown as DrizzleService);

    service = new GenerateRecurringTransactionsJobService(
      repository,
      new CalculateNextGenerationDateService(dateProvider),
      makeCache(),
      dateProvider,
    );
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
      startDate: dateProvider.startOfDay('2026-01-10', DEFAULT_TIMEZONE),
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

    return { ruleIds: rules.map((rule) => rule.id as string) };
  }

  async function generatedDays(ruleId: string): Promise<string[]> {
    const rows = await db
      .select({ date: schema.transactions.date })
      .from(schema.transactions)
      .where(eq(schema.transactions.recurringId, ruleId))
      .orderBy(asc(schema.transactions.date));

    return rows.map(({ date }) =>
      dateProvider.format(date, 'YYYY-MM-DD', DEFAULT_TIMEZONE),
    );
  }

  it('stops a three installment plan without endDate on its last parcel day', async () => {
    const {
      ruleIds: [ruleId],
    } = await seedRules([{ installmentCount: 3, endDate: null }]);
    const parcelDays = ['2026-01-10', '2026-02-10', '2026-03-10'];

    dateProvider.setNow('2026-04-20T12:00:00.000Z');
    await service.execute();
    expect(await generatedDays(ruleId)).toEqual(parcelDays);

    dateProvider.setNow('2026-11-20T12:00:00.000Z');
    await service.execute();
    expect(await generatedDays(ruleId)).toEqual(parcelDays);
  });
});
