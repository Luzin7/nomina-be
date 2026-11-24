import {
  AccountType,
  RecurrenceFrequency,
  TransactionStatus,
  TransactionType,
} from '@constants/enums';
import { CacheProvider } from '@infra/cache/contracts/CacheProvider';
import { DrizzleService } from '@infra/databases/drizzle/drizzle.service';
import * as schema from '@infra/databases/drizzle/schema';
import { TransactionPreviewPresenter } from '@modules/transaction/presenters/TransactionPreview.presenter';
import { CashFlowEvolutionService } from '@modules/report/features/get-cash-flow-evolution/cash-flow-evolution.handler';
import { GetWorkspaceTimezoneService } from '@modules/workspace/services/get-workspace-timezone.service';
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
import { CardCycleRepositoryImplementation } from './card-cycle.repository';
import {
  DATE_COLUMN_CASES,
  setDateColumns,
} from '../test-helpers/date-column-states';
import { TransactionRepositoryImplementation } from './transaction.repository';

const MIGRATIONS_FOLDER = resolve(__dirname, '../../../../../drizzle');
const RECIFE = 'America/Recife';

jest.setTimeout(180_000);

describe('timestamp column states against a real postgres', () => {
  let container: StartedPostgreSqlContainer;
  let adminClient: postgres.Sql;

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:16-alpine')
      .withStartupTimeout(120_000)
      .start();
    adminClient = postgres(container.getConnectionUri(), {
      max: 1,
      onnotice: () => undefined,
    });
    await migrate(drizzle(adminClient, { schema }), {
      migrationsFolder: MIGRATIONS_FOLDER,
    });
  });

  afterAll(async () => {
    await adminClient.end({ timeout: 5 });
    await container.stop();
  });

  describe.each(DATE_COLUMN_CASES)(
    'columns $columns, session time zone $sessionTimeZone',
    ({ columns, sessionTimeZone }) => {
      let queryClient: postgres.Sql;
      let db: ReturnType<typeof drizzle<typeof schema>>;
      let drizzleService: DrizzleService;

      beforeAll(async () => {
        await setDateColumns(adminClient, columns);
        queryClient = postgres(container.getConnectionUri(), {
          max: 5,
          onnotice: () => undefined,
          connection: { TimeZone: sessionTimeZone },
        });
        db = drizzle(queryClient, { schema });
        drizzleService = new DrizzleService(db);
      });

      afterAll(async () => {
        await queryClient.end({ timeout: 5 });
      });

      async function seedWorkspace() {
        const workspaceId = randomUUID();
        const accountId = randomUUID();
        const categoryId = randomUUID();
        await db
          .insert(schema.workspaces)
          .values({ id: workspaceId, name: 'WS' });
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

      function makeRow(
        seed: Awaited<ReturnType<typeof seedWorkspace>>,
        overrides: Partial<typeof schema.transactions.$inferInsert>,
      ): typeof schema.transactions.$inferInsert {
        return {
          id: randomUUID(),
          title: 'Transaction',
          amount: 1_000,
          type: TransactionType.EXPENSE,
          status: TransactionStatus.COMPLETED,
          date: new Date('2026-10-10T15:00:00Z'),
          ...seed,
          ...overrides,
        };
      }

      it('should bucket cash flow by the local day', async () => {
        const seed = await seedWorkspace();
        await db.insert(schema.transactions).values([
          makeRow(seed, {
            date: new Date('2026-10-01T01:30:00Z'),
            type: TransactionType.INCOME,
          }),
          makeRow(seed, {
            date: new Date('2026-10-01T03:00:00Z'),
            type: TransactionType.INCOME,
          }),
        ]);
        const service = new CashFlowEvolutionService(
          drizzleService,
          new DayJsDateProvider(),
          {
            execute: async () => RECIFE,
          } as unknown as GetWorkspaceTimezoneService,
          {
            get: async () => null,
            set: async () => true,
            readCounter: async () => 0,
          } as unknown as CacheProvider,
        );

        const result = await service.execute({
          workspaceId: seed.workspaceId,
          startDate: '2026-09-01',
          endDate: '2026-10-31',
        });

        expect(result.map(({ date, income }) => [date, income])).toEqual([
          ['2026-10-01', 10],
          ['2026-09-30', 10],
        ]);
      });

      it('should sum card cycle spend by the local day', async () => {
        const seed = await seedWorkspace();
        await db.insert(schema.transactions).values([
          makeRow(seed, {
            date: new Date('2026-11-22T02:59:00Z'),
            amount: 10,
          }),
          makeRow(seed, {
            date: new Date('2026-11-22T03:00:00Z'),
            amount: 1,
          }),
          makeRow(seed, {
            date: new Date('2026-12-22T02:59:00Z'),
            amount: 100,
          }),
          makeRow(seed, {
            date: new Date('2026-12-22T03:00:00Z'),
            amount: 1_000,
          }),
        ]);

        const total = await new CardCycleRepositoryImplementation(
          drizzleService,
        ).sumCycleSpend({
          workspaceId: seed.workspaceId,
          accountId: seed.accountId,
          timezone: RECIFE,
          periodStart: '2026-11-22',
          periodEnd: '2026-12-21',
        });

        expect(total).toBe(101);
      });

      it('should number installments by the local month', async () => {
        const seed = await seedWorkspace();
        const recurringId = randomUUID();
        const dates = [
          '2026-08-10T15:00:00Z',
          '2026-09-10T15:00:00Z',
          '2026-11-01T02:30:00Z',
        ];
        await db.insert(schema.recurringTransactions).values({
          id: recurringId,
          ...seed,
          title: 'Plan',
          amount: 1_000,
          type: TransactionType.EXPENSE,
          frequency: RecurrenceFrequency.MONTHLY,
          interval: 1,
          installmentCount: 4,
          startDate: new Date(dates[0]),
          active: false,
        });
        await db
          .insert(schema.transactions)
          .values(
            dates.map((date) =>
              makeRow(seed, { date: new Date(date), recurringId }),
            ),
          );

        const { transactions } = await new TransactionRepositoryImplementation(
          drizzleService,
        ).listTransactionsByWorkspaceId({
          workspaceId: seed.workspaceId,
          page: 1,
          pageSize: 50,
        });

        expect(
          transactions
            .map((item) => TransactionPreviewPresenter.toHTTP(item))
            .map((item) => [
              item.date.toISOString().slice(0, 10),
              item.installmentNumber,
            ])
            .sort(),
        ).toEqual([
          ['2026-08-10', 1],
          ['2026-09-10', 2],
          ['2026-11-01', 3],
        ]);
      });
    },
  );
});
