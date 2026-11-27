import { CacheProvider } from '@infra/cache/contracts/CacheProvider';
import { DRIZZLE_TOKEN } from '@infra/databases/drizzle/drizzle.provider';
import { DrizzleService } from '@infra/databases/drizzle/drizzle.service';
import { WorkspaceRepositoryImplementation } from '@infra/databases/drizzle/repositories/workspace.repository';
import * as schema from '@infra/databases/drizzle/schema';
import { AccountRepository } from '@modules/account/repositories/contracts/AccountRepository';
import { DeleteRecurringTransactionService } from '@modules/transaction/features/delete-recurring-transaction/delete-recurring-transaction.service';
import { GenerateRecurringTransactionsJobService } from '@modules/transaction/jobs/generate-recurring-transactions/generate-recurring-transactions.service';
import { CalculateNextGenerationDateService } from '@modules/transaction/services/calculate-next-generation-date.service';
import { WorkspaceRepository } from '@modules/workspace/repositories/contracts/WorkspaceRepository';
import { GetWorkspaceTimezoneService } from '@modules/workspace/services/get-workspace-timezone.service';
import { DayJsDateProvider } from '@providers/date/implementations/Dayjs';
import { captureException } from '@sentry/nestjs';
import { getErrorDetails } from '@shared/utils/error-details';
import { Logger } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import {
  PostgreSqlContainer,
  StartedPostgreSqlContainer,
} from '@testcontainers/postgresql';
import { eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import postgres from 'postgres';
import { RecurringTransactionRepositoryImplementation } from './recurring-transaction.repository';

jest.mock('@sentry/nestjs', () => ({ captureException: jest.fn() }));

const mockCaptureException = captureException as jest.MockedFunction<
  typeof captureException
>;

const MIGRATIONS_FOLDER = join(__dirname, '../../../../../drizzle');
const TIMEZONE = 'America/Sao_Paulo';
const TODAY_START = new Date('2026-03-15T03:00:00.000Z');
const NOW = new Date('2026-03-15T15:00:00.000Z');
const DELETE_WAIT_POLL_TIMEOUT_MS = 2_000;
const DELETE_WAIT_POLL_INTERVAL_MS = 10;

jest.setTimeout(180_000);

type Db = DrizzleService['db'];
type ReservedConnection = Awaited<ReturnType<postgres.Sql['reserve']>>;

type Owner = {
  workspaceId: string;
  accountId: string;
  categoryId: string;
};

const loggerWarn = jest
  .spyOn(Logger.prototype, 'warn')
  .mockImplementation(() => undefined);

function loggedSkipFor(recurringId: string): boolean {
  return loggerWarn.mock.calls.some(([message]) =>
    String(message).includes(recurringId),
  );
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function seedWorkspace(db: Db): Promise<Owner> {
  const workspaceId = randomUUID();
  const accountId = randomUUID();
  const categoryId = randomUUID();

  await db
    .insert(schema.workspaces)
    .values({ id: workspaceId, name: 'Workspace' });
  await db.insert(schema.accounts).values({
    id: accountId,
    workspaceId,
    name: 'Account',
    type: 'CHECKING',
  });
  await db.insert(schema.categories).values({
    id: categoryId,
    workspaceId,
    name: 'Category',
    type: 'EXPENSE',
  });

  return { workspaceId, accountId, categoryId };
}

async function seedRule(
  db: Db,
  owner: Owner,
  startDate: Date,
): Promise<string> {
  const recurringId = randomUUID();

  await db.insert(schema.recurringTransactions).values({
    id: recurringId,
    workspaceId: owner.workspaceId,
    accountId: owner.accountId,
    categoryId: owner.categoryId,
    type: 'EXPENSE',
    title: 'Rent',
    amount: 1000,
    frequency: 'MONTHLY',
    startDate,
  });

  return recurringId;
}

async function findRule(db: Db, id: string) {
  const [rule] = await db
    .select()
    .from(schema.recurringTransactions)
    .where(eq(schema.recurringTransactions.id, id));

  return rule;
}

async function occurrencesOf(db: Db, recurringId: string) {
  return db
    .select()
    .from(schema.transactions)
    .where(eq(schema.transactions.recurringId, recurringId));
}

async function countFuturePendingOrphans(
  db: Db,
  workspaceId: string,
): Promise<number> {
  const [row] = await db.execute<{ total: number }>(sql`
    SELECT count(*)::int AS total
    FROM transactions
    WHERE workspace_id = ${workspaceId}
      AND status = 'PENDING'
      AND recurring_transaction_id IS NULL
      AND (${schema.transactions.date} AT TIME ZONE ${TIMEZONE})::date
        > (${TODAY_START.toISOString()}::timestamptz AT TIME ZONE ${TIMEZONE})::date
  `);

  return row?.total ?? 0;
}

async function acquireRuleLock(
  connection: ReservedConnection,
  recurringId: string,
): Promise<void> {
  await connection.unsafe('BEGIN');
  await connection.unsafe(
    'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
    [recurringId],
  );
}

async function backendPid(connection: ReservedConnection): Promise<number> {
  const [row] = await connection.unsafe<{ pid: number }[]>(
    'SELECT pg_backend_pid() AS pid',
  );

  return row.pid;
}

async function countBackendsWaitingOnRuleLock(
  db: Db,
  heldPid: number,
): Promise<number> {
  const [row] = await db.execute<{ total: number }>(sql`
    SELECT count(*)::int AS total
    FROM pg_locks waiting
    JOIN pg_locks held
      ON held.locktype = waiting.locktype
     AND held.database IS NOT DISTINCT FROM waiting.database
     AND held.classid = waiting.classid
     AND held.objid = waiting.objid
     AND held.objsubid = waiting.objsubid
    WHERE waiting.locktype = 'advisory'
      AND NOT waiting.granted
      AND held.granted
      AND held.pid = ${heldPid}
  `);

  return row?.total ?? 0;
}

async function waitForDeleteToBlockOnRuleLock(
  db: Db,
  heldPid: number,
): Promise<number> {
  const deadline = Date.now() + DELETE_WAIT_POLL_TIMEOUT_MS;

  while (Date.now() < deadline) {
    const waiting = await countBackendsWaitingOnRuleLock(db, heldPid);
    if (waiting > 0) return waiting;

    await wait(DELETE_WAIT_POLL_INTERVAL_MS);
  }

  return 0;
}

async function closeConnection(
  connection: ReservedConnection | null,
): Promise<void> {
  if (!connection) return;

  await connection.unsafe('ROLLBACK').catch(() => undefined);
  connection.release();
}

describe('recurring transaction delete and generation overlap', () => {
  let container: StartedPostgreSqlContainer;
  let queryClient: postgres.Sql;
  let moduleRef: TestingModule;
  let db: DrizzleService['db'];
  let repository: RecurringTransactionRepositoryImplementation;
  let job: GenerateRecurringTransactionsJobService;
  let dateProvider: DayJsDateProvider;
  let cache: CacheProvider;
  let workspaceTimezone: GetWorkspaceTimezoneService;

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:16-alpine')
      .withStartupTimeout(120_000)
      .start();
    queryClient = postgres(container.getConnectionUri(), {
      max: 5,
      onnotice: () => undefined,
    });
    const drizzleDb = drizzle(queryClient, { schema });
    await migrate(drizzleDb, { migrationsFolder: MIGRATIONS_FOLDER });

    moduleRef = await Test.createTestingModule({
      providers: [
        DrizzleService,
        { provide: DRIZZLE_TOKEN, useValue: drizzleDb },
        RecurringTransactionRepositoryImplementation,
        {
          provide: WorkspaceRepository,
          useClass: WorkspaceRepositoryImplementation,
        },
      ],
    }).compile();

    db = moduleRef.get(DrizzleService).db;
    repository = moduleRef.get(RecurringTransactionRepositoryImplementation);

    const dateProviderInstance = new DayJsDateProvider();
    jest.spyOn(dateProviderInstance, 'now').mockReturnValue(NOW);
    dateProvider = dateProviderInstance;
    cache = {
      isEnabled: true,
      exists: jest.fn().mockResolvedValue(false),
      acquireLock: jest
        .fn()
        .mockResolvedValue({ key: 'lock:recurring', token: 'token' }),
      releaseLock: jest.fn().mockResolvedValue(true),
      get: jest.fn().mockResolvedValue(null),
      set: jest.fn().mockResolvedValue(true),
      incrementCounter: jest.fn().mockResolvedValue(1),
    } as unknown as CacheProvider;
    workspaceTimezone = new GetWorkspaceTimezoneService(
      moduleRef.get(WorkspaceRepository),
      cache,
    );

    job = new GenerateRecurringTransactionsJobService(
      repository,
      new CalculateNextGenerationDateService(dateProvider),
      cache,
      dateProvider,
      workspaceTimezone,
    );
  });

  afterAll(async () => {
    await moduleRef?.close();
    await queryClient?.end({ timeout: 5 });
    await container?.stop();
  });

  beforeEach(async () => {
    loggerWarn.mockClear();
    mockCaptureException.mockClear();
    await db.execute(
      sql`TRUNCATE workspaces, accounts, categories, recurring_transactions, transactions RESTART IDENTITY CASCADE`,
    );
  });

  it('should generate nothing for a rule whose delete holds the lock and keep processing the remaining rules', async () => {
    const owner = await seedWorkspace(db);
    const ruleUnderDelete = await seedRule(
      db,
      owner,
      new Date('2026-03-20T00:00:00Z'),
    );
    const otherRule = await seedRule(
      db,
      owner,
      new Date('2026-01-10T00:00:00Z'),
    );
    let deleteConnection: ReservedConnection | null = null;

    try {
      deleteConnection = await queryClient.reserve();
      await acquireRuleLock(deleteConnection, ruleUnderDelete);

      const result = await job.execute();

      await deleteConnection.unsafe(
        'DELETE FROM recurring_transactions WHERE id = $1',
        [ruleUnderDelete],
      );
      await deleteConnection.unsafe('COMMIT');

      expect(await findRule(db, ruleUnderDelete)).toBeUndefined();
      expect(await countFuturePendingOrphans(db, owner.workspaceId)).toBe(0);
      expect(await occurrencesOf(db, otherRule)).toHaveLength(3);
      expect(loggedSkipFor(ruleUnderDelete)).toBe(true);
      if (result.isRight()) {
        expect(result.value.generatedCount).toBe(3);
        expect(result.value.failedCount).toBe(0);
      }
    } finally {
      await closeConnection(deleteConnection);
    }
  });

  it('should keep a surviving orphan visible to this check when the generation lock is not honoured', async () => {
    const owner = await seedWorkspace(db);
    const orphan = randomUUID();

    await db.insert(schema.transactions).values({
      id: orphan,
      workspaceId: owner.workspaceId,
      accountId: owner.accountId,
      categoryId: owner.categoryId,
      title: 'Orphan',
      amount: 1000,
      date: new Date('2026-03-20T00:00:00Z'),
      type: 'EXPENSE',
      status: 'PENDING',
    });

    expect(await countFuturePendingOrphans(db, owner.workspaceId)).toBe(1);
  });

  it('should wait for the generation lock before deleting', async () => {
    const owner = await seedWorkspace(db);
    const recurringId = await seedRule(
      db,
      owner,
      new Date('2026-03-20T00:00:00Z'),
    );
    let generationConnection: ReservedConnection | null = null;

    try {
      generationConnection = await queryClient.reserve();
      await acquireRuleLock(generationConnection, recurringId);
      const generationPid = await backendPid(generationConnection);

      const deletion = repository.deleteWithFuturePendingOccurrences(
        recurringId,
        {
          workspaceId: owner.workspaceId,
          timezone: TIMEZONE,
          todayStart: TODAY_START,
        },
      );

      expect(
        await waitForDeleteToBlockOnRuleLock(db, generationPid),
      ).toBeGreaterThan(0);

      await generationConnection.unsafe('COMMIT');
      await deletion;

      expect(await findRule(db, recurringId)).toBeUndefined();
    } finally {
      await closeConnection(generationConnection);
    }
  });

  it('should surface the lock timeout when generation holds the lock past the delete limit', async () => {
    const owner = await seedWorkspace(db);
    const recurringId = await seedRule(
      db,
      owner,
      new Date('2026-03-20T00:00:00Z'),
    );
    const service = new DeleteRecurringTransactionService(
      repository,
      {
        findById: jest.fn().mockResolvedValue({ timezone: TIMEZONE }),
      } as unknown as AccountRepository,
      dateProvider,
      cache,
    );
    let generationConnection: ReservedConnection | null = null;

    try {
      generationConnection = await queryClient.reserve();
      await acquireRuleLock(generationConnection, recurringId);

      let sqlState: string | null = null;
      try {
        await service.execute({
          recurringTransactionId: recurringId,
          workspaceId: owner.workspaceId,
        });
      } catch (error: unknown) {
        sqlState = getErrorDetails(error).sqlState;
      }

      expect(sqlState).toBe('55P03');
      expect(await findRule(db, recurringId)).toBeDefined();
    } finally {
      await closeConnection(generationConnection);
    }
  });

  it('should skip a rule deleted between the lock attempt and the insert without a failure', async () => {
    const owner = await seedWorkspace(db);
    const racedRule = await seedRule(
      db,
      owner,
      new Date('2026-03-20T00:00:00Z'),
    );
    const otherRule = await seedRule(
      db,
      owner,
      new Date('2026-01-10T00:00:00Z'),
    );
    const racingRepository = Object.create(
      repository,
    ) as RecurringTransactionRepositoryImplementation;

    racingRepository.createGeneratedTransactions = async (
      transactions,
      updated,
    ) => {
      if (updated.id === racedRule) {
        await db
          .delete(schema.recurringTransactions)
          .where(eq(schema.recurringTransactions.id, racedRule));
      }

      return repository.createGeneratedTransactions(transactions, updated);
    };

    const racingJob = new GenerateRecurringTransactionsJobService(
      racingRepository,
      new CalculateNextGenerationDateService(dateProvider),
      cache,
      dateProvider,
      workspaceTimezone,
    );

    const result = await racingJob.execute();

    expect(loggerWarn).toHaveBeenCalledWith(
      expect.stringContaining('skipped-rule-gone'),
    );
    expect(mockCaptureException).not.toHaveBeenCalled();
    expect(await occurrencesOf(db, racedRule)).toHaveLength(0);
    expect(await occurrencesOf(db, otherRule)).toHaveLength(3);
    if (result.isRight()) {
      expect(result.value.failedCount).toBe(0);
      expect(result.value.generatedCount).toBe(3);
    }
  });
});
