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
  PlanExhaustionInput,
  isPlanExhaustedBefore,
} from '@utils/installmentSchedule';
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

jest.setTimeout(180_000);

type RecurringRow = typeof schema.recurringTransactions.$inferInsert;

type PlanCase = {
  key: string;
  installmentCount: number | null;
  endDate: Date | null;
};

type BoundaryExpectation = {
  summary: boolean;
  generator: boolean;
};

const MIGRATIONS_FOLDER = resolve(__dirname, '../../../../../drizzle');
const START_DAY = '2026-01-10';
const LAST_PARCEL_DAY = '2026-03-10';
const dateProvider = new DayJsDateProvider();

const localDayStart = (localDate: string): Date =>
  dateProvider.startOfDay(localDate, DEFAULT_TIMEZONE);

const END_DATE_PLAN: PlanCase = {
  key: 'endDate',
  installmentCount: null,
  endDate: localDayStart(LAST_PARCEL_DAY),
};
const INSTALLMENT_PLAN: PlanCase = {
  key: 'installments',
  installmentCount: 3,
  endDate: null,
};
const OPEN_PLAN: PlanCase = {
  key: 'open',
  installmentCount: null,
  endDate: null,
};

const END_DATE_ROWS: Array<[string, BoundaryExpectation]> = [
  ['2026-03-09', { summary: false, generator: false }],
  [LAST_PARCEL_DAY, { summary: false, generator: false }],
  ['2026-03-11', { summary: true, generator: true }],
];

const INSTALLMENT_ROWS: Array<[string, BoundaryExpectation]> = [
  ['2026-03-09', { summary: false, generator: false }],
  [LAST_PARCEL_DAY, { summary: true, generator: false }],
  ['2026-03-11', { summary: true, generator: true }],
];

const OPEN_ROWS: Array<[string, BoundaryExpectation]> = [
  ['2026-03-10', { summary: false, generator: false }],
  ['2099-12-31', { summary: false, generator: false }],
];

function planOf(planCase: PlanCase): PlanExhaustionInput {
  return {
    startDate: localDayStart(START_DAY),
    frequency: RecurrenceFrequency.MONTHLY,
    interval: 1,
    timezone: DEFAULT_TIMEZONE,
    installmentCount: planCase.installmentCount,
    endDate: planCase.endDate,
  };
}

describe('recurring exhaustion parity against a real postgres', () => {
  let container: StartedPostgreSqlContainer;
  let queryClient: postgres.Sql;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  let repository: RecurringTransactionRepositoryImplementation;
  const workspaceIds = new Map<string, string>();

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

    for (const planCase of [END_DATE_PLAN, INSTALLMENT_PLAN, OPEN_PLAN]) {
      workspaceIds.set(planCase.key, await seedRule(planCase));
    }
  });

  afterAll(async () => {
    await queryClient?.end({ timeout: 5 });
    await container?.stop();
  });

  function makeRule(
    planCase: PlanCase,
    ids: Pick<RecurringRow, 'workspaceId' | 'accountId' | 'categoryId'>,
  ): RecurringRow {
    return {
      id: randomUUID(),
      title: 'Rule',
      amount: 1_000,
      type: TransactionType.EXPENSE,
      frequency: RecurrenceFrequency.MONTHLY,
      interval: 1,
      startDate: localDayStart(START_DAY),
      installmentCount: planCase.installmentCount,
      endDate: planCase.endDate,
      ...ids,
    };
  }

  async function seedRule(planCase: PlanCase): Promise<string> {
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
    await db
      .insert(schema.recurringTransactions)
      .values(makeRule(planCase, { workspaceId, accountId, categoryId }));

    return workspaceId;
  }

  async function boundaries(
    planCase: PlanCase,
    localDate: string,
  ): Promise<BoundaryExpectation> {
    const todayStart = localDayStart(localDate);
    const [rule] = await repository.findSummaryRules({
      workspaceId: workspaceIds.get(planCase.key) as string,
      now: todayStart,
    });

    return {
      summary: rule.exhausted,
      generator: isPlanExhaustedBefore(
        planOf(planCase),
        todayStart,
        dateProvider,
      ),
    };
  }

  it.each(END_DATE_ROWS)(
    'should exhaust an endDate plan on the same day in the summary and the generator: %s',
    async (day, expected) => {
      expect(await boundaries(END_DATE_PLAN, day)).toEqual(expected);
    },
  );

  it.each(INSTALLMENT_ROWS)(
    'should keep the summary one day ahead of the generator across the last parcel day: %s',
    async (day, expected) => {
      expect(await boundaries(INSTALLMENT_PLAN, day)).toEqual(expected);
    },
  );

  it.each(OPEN_ROWS)(
    'should never exhaust a plan without endDate or installment count: %s',
    async (day, expected) => {
      expect(await boundaries(OPEN_PLAN, day)).toEqual(expected);
    },
  );
});
