import {
  BalanceMovementCause,
  TransactionStatus,
  TransactionType,
} from '@constants/enums';
import { CacheProvider } from '@infra/cache/contracts/CacheProvider';
import { DRIZZLE_TOKEN } from '@infra/databases/drizzle/drizzle.provider';
import { DrizzleService } from '@infra/databases/drizzle/drizzle.service';
import { TransactionRepositoryImplementation } from '@infra/databases/drizzle/repositories/transaction.repository';
import * as schema from '@infra/databases/drizzle/schema';
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
import { SettleCardInstallmentsJobService } from './settle-card-installments.service';

const MIGRATIONS_FOLDER = resolve(__dirname, '../../../../../drizzle');
const NOW = new Date('2024-01-15T15:00:00.000Z');
const DUE_DATE = new Date('2024-01-10T15:00:00.000Z');
const FUTURE_DATE = new Date('2024-01-25T15:00:00.000Z');
const DUE_COUNT = 5;
const AMOUNT = 1_000;
const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
const SECOND_MS = 1_000;
const LOCAL_DAY_START_UTC = Date.UTC(2024, 0, 15);
const ZONES = [
  { timezone: 'America/Sao_Paulo', offsetHours: -3 },
  { timezone: 'Asia/Tokyo', offsetHours: 9 },
];
const DATE_COLUMN_TYPES = [
  'timestamp with time zone',
  'timestamp without time zone',
];

const localMidnight = (offsetHours: number, dayOffset = 0): number =>
  LOCAL_DAY_START_UTC + dayOffset * DAY_MS - offsetHours * HOUR_MS;

jest.setTimeout(180_000);

describe('settle card installments against a real postgres', () => {
  let container: StartedPostgreSqlContainer;
  let queryClient: postgres.Sql;
  let moduleRef: TestingModule;
  let db: DrizzleService['db'];
  let service: SettleCardInstallmentsJobService;
  let dateProvider: DayJsDateProvider;

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
          provide: TransactionRepository,
          useClass: TransactionRepositoryImplementation,
        },
        {
          provide: CacheProvider,
          useValue: { delByPattern: jest.fn().mockResolvedValue(0) },
        },
        { provide: DateProvider, useValue: dateProvider },
        SettleCardInstallmentsJobService,
      ],
    }).compile();

    db = moduleRef.get(DrizzleService).db;
    service = moduleRef.get(SettleCardInstallmentsJobService);
  });

  afterAll(async () => {
    await moduleRef?.close();
    await queryClient?.end({ timeout: 5 });
    await container?.stop();
  });

  beforeEach(async () => {
    jest.spyOn(dateProvider, 'now').mockReturnValue(NOW);
    await db.execute(
      sql`TRUNCATE accounts, transactions, recurring_transactions, balance_movements, workspaces, categories RESTART IDENTITY CASCADE`,
    );
  });

  async function seedWorkspace(): Promise<{
    workspaceId: string;
    categoryId: string;
  }> {
    const workspaceId = randomUUID();
    const categoryId = randomUUID();

    await db.insert(schema.workspaces).values({
      id: workspaceId,
      name: 'Settlement',
      timezone: 'UTC',
    });
    await db.insert(schema.categories).values({
      id: categoryId,
      workspaceId,
      name: `Category ${categoryId}`,
      type: TransactionType.EXPENSE,
    });

    return { workspaceId, categoryId };
  }

  async function seedAccount(
    workspaceId: string,
    type: 'CREDIT_CARD' | 'CHECKING',
    { timezone = 'UTC', creditLimit = 1_000_000 } = {},
  ): Promise<string> {
    const accountId = randomUUID();

    await db.insert(schema.accounts).values({
      id: accountId,
      workspaceId,
      name: `${type} ${accountId}`,
      type,
      balance: 0,
      timezone,
      dueDay: type === 'CREDIT_CARD' ? 20 : null,
      creditLimit: type === 'CREDIT_CARD' ? creditLimit : null,
    });
    await db.insert(schema.balanceMovements).values({
      workspaceId,
      accountId,
      cause: BalanceMovementCause.OPENING,
      delta: 0,
      balanceAfter: 0,
    });

    return accountId;
  }

  async function seedPending(
    seed: { workspaceId: string; categoryId: string; accountId: string },
    date: Date,
    {
      recurring = true,
      installmentGroupId = undefined as string | undefined,
      type = TransactionType.EXPENSE,
    } = {},
  ): Promise<string> {
    const id = randomUUID();
    const recurringId = recurring ? await seedRecurring(seed, date) : undefined;

    await db.insert(schema.transactions).values({
      id,
      workspaceId: seed.workspaceId,
      accountId: seed.accountId,
      categoryId: seed.categoryId,
      recurringId,
      installmentGroupId,
      title: `Pending ${id}`,
      amount: AMOUNT,
      date,
      type,
      status: TransactionStatus.PENDING,
    });

    return id;
  }

  async function seedRecurring(
    seed: { workspaceId: string; categoryId: string; accountId: string },
    startDate: Date,
  ): Promise<string> {
    const id = randomUUID();

    await db.insert(schema.recurringTransactions).values({
      id,
      workspaceId: seed.workspaceId,
      accountId: seed.accountId,
      categoryId: seed.categoryId,
      type: TransactionType.EXPENSE,
      title: `Recurring ${id}`,
      amount: AMOUNT,
      frequency: 'MONTHLY',
      startDate,
    });

    return id;
  }

  async function statusOf(id: string): Promise<string | undefined> {
    const [row] = await db
      .select({ status: schema.transactions.status })
      .from(schema.transactions)
      .where(eq(schema.transactions.id, id));

    return row?.status;
  }

  async function settlementMovementsOf(accountId: string) {
    return db
      .select()
      .from(schema.balanceMovements)
      .where(
        sql`${schema.balanceMovements.accountId} = ${accountId} AND ${schema.balanceMovements.cause} = ${BalanceMovementCause.STATUS_CHANGED}`,
      );
  }

  async function balanceOf(accountId: string): Promise<number | undefined> {
    const [row] = await db
      .select({ balance: schema.accounts.balance })
      .from(schema.accounts)
      .where(eq(schema.accounts.id, accountId));

    return row?.balance;
  }

  it('should settle each due card row once and move the balance once when two runs overlap', async () => {
    const { workspaceId, categoryId } = await seedWorkspace();
    const accountId = await seedAccount(workspaceId, 'CREDIT_CARD');
    const seed = { workspaceId, categoryId, accountId };
    const dueIds = await Promise.all(
      Array.from({ length: DUE_COUNT }, () => seedPending(seed, DUE_DATE)),
    );

    const [first, second] = await Promise.all([
      service.execute(),
      service.execute(),
    ]);

    expect(first.settledCount + second.settledCount).toBe(DUE_COUNT);
    expect(first.failedCount + second.failedCount).toBe(0);
    expect(await Promise.all(dueIds.map((id) => statusOf(id)))).toEqual(
      Array(DUE_COUNT).fill(TransactionStatus.COMPLETED),
    );
    expect(await settlementMovementsOf(accountId)).toHaveLength(DUE_COUNT);
    expect(Math.abs((await balanceOf(accountId)) ?? 0)).toBe(
      DUE_COUNT * AMOUNT,
    );
  });

  it('should settle nothing on a second run', async () => {
    const { workspaceId, categoryId } = await seedWorkspace();
    const accountId = await seedAccount(workspaceId, 'CREDIT_CARD');
    await seedPending({ workspaceId, categoryId, accountId }, DUE_DATE);

    await service.execute();
    const balanceAfterFirst = await balanceOf(accountId);
    const second = await service.execute();

    expect(second.processedCount).toBe(0);
    expect(await balanceOf(accountId)).toBe(balanceAfterFirst);
  });

  it('should settle a due card row of an installment group without a recurrence', async () => {
    const { workspaceId, categoryId } = await seedWorkspace();
    const accountId = await seedAccount(workspaceId, 'CREDIT_CARD');
    const id = await seedPending(
      { workspaceId, categoryId, accountId },
      DUE_DATE,
      { recurring: false, installmentGroupId: randomUUID() },
    );

    await service.execute();

    expect(await statusOf(id)).toBe(TransactionStatus.COMPLETED);
  });

  it('should leave a due card row with neither recurrence nor installment group pending', async () => {
    const { workspaceId, categoryId } = await seedWorkspace();
    const accountId = await seedAccount(workspaceId, 'CREDIT_CARD');
    const id = await seedPending(
      { workspaceId, categoryId, accountId },
      DUE_DATE,
      { recurring: false },
    );

    const summary = await service.execute();

    expect(summary.outcome).toBe('nothing-due');
    expect(await statusOf(id)).toBe(TransactionStatus.PENDING);
  });

  it('should settle a due card row that has a recurrence', async () => {
    const { workspaceId, categoryId } = await seedWorkspace();
    const accountId = await seedAccount(workspaceId, 'CREDIT_CARD');
    const id = await seedPending(
      { workspaceId, categoryId, accountId },
      DUE_DATE,
    );

    await service.execute();

    expect(await statusOf(id)).toBe(TransactionStatus.COMPLETED);
  });

  it('should settle a due installment that exceeds the card limit', async () => {
    const { workspaceId, categoryId } = await seedWorkspace();
    const accountId = await seedAccount(workspaceId, 'CREDIT_CARD', {
      creditLimit: AMOUNT / 2,
    });
    const id = await seedPending(
      { workspaceId, categoryId, accountId },
      DUE_DATE,
    );

    const summary = await service.execute();

    expect(summary.failedCount).toBe(0);
    expect(await statusOf(id)).toBe(TransactionStatus.COMPLETED);
    expect(await balanceOf(accountId)).toBe(AMOUNT);
    expect(await settlementMovementsOf(accountId)).toHaveLength(1);
  });

  it('should settle a due refund above the owed balance', async () => {
    const { workspaceId, categoryId } = await seedWorkspace();
    const accountId = await seedAccount(workspaceId, 'CREDIT_CARD');
    const id = await seedPending(
      { workspaceId, categoryId, accountId },
      DUE_DATE,
      { type: TransactionType.INCOME },
    );

    const summary = await service.execute();

    expect(summary.failedCount).toBe(0);
    expect(await statusOf(id)).toBe(TransactionStatus.COMPLETED);
    expect(await balanceOf(accountId)).toBe(-AMOUNT);
  });

  it('should still reject a user-initiated completion over the card limit', async () => {
    const { workspaceId, categoryId } = await seedWorkspace();
    const accountId = await seedAccount(workspaceId, 'CREDIT_CARD', {
      creditLimit: AMOUNT / 2,
    });
    const id = await seedPending(
      { workspaceId, categoryId, accountId },
      DUE_DATE,
    );

    const result = await moduleRef
      .get(TransactionRepository)
      .updateStatusWithBalanceEffect(
        { transactionId: id, workspaceId, status: TransactionStatus.COMPLETED },
        { actorId: 'user-1' },
      );

    expect(result.isLeft()).toBe(true);
    expect(await statusOf(id)).toBe(TransactionStatus.PENDING);
    expect(await balanceOf(accountId)).toBe(0);
  });

  it('should leave future card rows and non-card rows pending', async () => {
    const { workspaceId, categoryId } = await seedWorkspace();
    const cardId = await seedAccount(workspaceId, 'CREDIT_CARD');
    const checkingId = await seedAccount(workspaceId, 'CHECKING');
    const futureCardTx = await seedPending(
      { workspaceId, categoryId, accountId: cardId },
      FUTURE_DATE,
    );
    const dueCheckingTx = await seedPending(
      { workspaceId, categoryId, accountId: checkingId },
      DUE_DATE,
    );

    const summary = await service.execute();

    expect(summary.outcome).toBe('nothing-due');
    expect(await statusOf(futureCardTx)).toBe(TransactionStatus.PENDING);
    expect(await statusOf(dueCheckingTx)).toBe(TransactionStatus.PENDING);
  });
  describe.each(DATE_COLUMN_TYPES)(
    'day boundaries with a %s date column',
    (columnType) => {
      beforeAll(async () => {
        await db.execute(
          sql.raw(
            `ALTER TABLE transactions ALTER COLUMN date TYPE ${columnType} USING date AT TIME ZONE 'UTC'`,
          ),
        );
      });

      it('should run the database session in UTC', async () => {
        const [row] = await db.execute<{ TimeZone: string }>(
          sql`SHOW TIME ZONE`,
        );

        expect(row?.TimeZone).toBe('UTC');
      });

      describe.each(ZONES)('in $timezone', ({ timezone, offsetHours }) => {
        const dayStart = localMidnight(offsetHours);
        const nextDayStart = localMidnight(offsetHours, 1);

        async function seedCardTransactionAt(instantMs: number) {
          const { workspaceId, categoryId } = await seedWorkspace();
          const accountId = await seedAccount(workspaceId, 'CREDIT_CARD', {
            timezone,
          });

          return seedPending(
            { workspaceId, categoryId, accountId },
            new Date(instantMs),
          );
        }

        it.each([
          ['one second before local midnight', dayStart - SECOND_MS],
          ['local midnight', dayStart],
          [
            'one second before the next local midnight',
            nextDayStart - SECOND_MS,
          ],
        ])(
          'should settle a row at %s on the current local day',
          async (_, instantMs) => {
            jest
              .spyOn(dateProvider, 'now')
              .mockReturnValue(new Date(dayStart + 12 * HOUR_MS));
            const id = await seedCardTransactionAt(instantMs);

            await service.execute();

            expect(await statusOf(id)).toBe(TransactionStatus.COMPLETED);
          },
        );

        it('should keep a row at the next local midnight pending', async () => {
          jest
            .spyOn(dateProvider, 'now')
            .mockReturnValue(new Date(dayStart + 12 * HOUR_MS));
          const id = await seedCardTransactionAt(nextDayStart);

          await service.execute();

          expect(await statusOf(id)).toBe(TransactionStatus.PENDING);
        });

        it('should keep a row pending one second before its local day starts', async () => {
          jest
            .spyOn(dateProvider, 'now')
            .mockReturnValue(new Date(nextDayStart - SECOND_MS));
          const id = await seedCardTransactionAt(nextDayStart);

          await service.execute();

          expect(await statusOf(id)).toBe(TransactionStatus.PENDING);
        });

        it('should settle a row once its local day starts', async () => {
          jest
            .spyOn(dateProvider, 'now')
            .mockReturnValue(new Date(nextDayStart));
          const id = await seedCardTransactionAt(nextDayStart);

          await service.execute();

          expect(await statusOf(id)).toBe(TransactionStatus.COMPLETED);
        });
      });
    },
  );
});
