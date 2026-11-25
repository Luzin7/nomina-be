import {
  AccountType,
  TransactionStatus,
  TransactionType,
} from '@constants/enums';
import { DrizzleService } from '@infra/databases/drizzle/drizzle.service';
import * as schema from '@infra/databases/drizzle/schema';
import { RecurringSuggestionRepositoryImplementation } from '@infra/databases/drizzle/repositories/recurring-suggestion.repository';
import { DetectRecurringSuggestionsService } from '@modules/transaction/features/recurring-suggestions/detect-recurring-suggestions.service';
import { DetectedBillSuggestion } from '@modules/transaction/valueObjects/BillSuggestionDetection';
import { WorkspaceRepository } from '@modules/workspace/repositories/contracts/WorkspaceRepository';
import { GetWorkspaceTimezoneService } from '@modules/workspace/services/get-workspace-timezone.service';
import { Logger } from '@nestjs/common';
import { DayJsDateProvider } from '@providers/date/implementations/Dayjs';
import { InMemoryCacheProvider } from '@shared/cache/test-helpers/in-memory-cache';
import { ledgerGenerationKey } from '@shared/cache/report-cache';
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
import { DetectRecurringSuggestionsJobService } from './detect-recurring-suggestions.service';

type Database = ReturnType<typeof drizzle<typeof schema>>;

const MIGRATIONS_FOLDER = resolve(__dirname, '../../../../../drizzle');
const NOW = new Date('2026-07-01T02:00:00.000Z');
const LAST_DETECTION = new Date('2026-06-15T12:00:00.000Z');

class FixedDateProvider extends DayJsDateProvider {
  constructor(private readonly fixedNow: Date) {
    super();
  }

  override now(): Date {
    return this.fixedNow;
  }
}

jest.setTimeout(180_000);

describe('Recurring suggestion detection against a real postgres', () => {
  let container: StartedPostgreSqlContainer;
  let queryClient: postgres.Sql;
  let db: Database;
  let repository: RecurringSuggestionRepositoryImplementation;
  let detection: DetectRecurringSuggestionsService;
  let job: DetectRecurringSuggestionsJobService;
  let cache: InMemoryCacheProvider;
  let errorSpy: jest.SpyInstance | undefined;

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:16-alpine')
      .withStartupTimeout(120_000)
      .start();

    queryClient = postgres(container.getConnectionUri(), {
      max: 5,
      onnotice: () => undefined,
      connection: { TimeZone: 'UTC' },
    });
    db = drizzle(queryClient, { schema });

    await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });

    const dateProvider = new FixedDateProvider(NOW);
    repository = new RecurringSuggestionRepositoryImplementation(
      new DrizzleService(db),
      dateProvider,
    );
    cache = new InMemoryCacheProvider();

    const workspaceRepository = {
      findTimezoneById: async (id: string) => {
        const [row] = await db
          .select({ timezone: schema.workspaces.timezone })
          .from(schema.workspaces)
          .where(eq(schema.workspaces.id, id));

        return row?.timezone ?? null;
      },
    } as unknown as WorkspaceRepository;
    const timezoneService = new GetWorkspaceTimezoneService(
      workspaceRepository,
      cache,
    );

    detection = new DetectRecurringSuggestionsService(
      repository,
      timezoneService,
      dateProvider,
      cache,
    );
    job = new DetectRecurringSuggestionsJobService(
      repository,
      detection,
      cache,
      dateProvider,
    );
  });

  afterAll(async () => {
    await queryClient.end({ timeout: 5 });
    await container.stop();
  });

  beforeEach(async () => {
    errorSpy?.mockRestore();
    errorSpy = undefined;
    jest.restoreAllMocks();
    await db.execute(
      sql`TRUNCATE workspaces, categories, accounts, transactions,
        recurring_transactions, recurring_suggestions,
        recurring_suggestion_transactions RESTART IDENTITY CASCADE`,
    );
  });

  async function seedWorkspace(
    timezone: string,
    lastBillDetectionAt: Date | null = null,
  ) {
    const workspaceId = randomUUID();
    const accountId = randomUUID();
    const categoryId = randomUUID();

    await db.insert(schema.workspaces).values({
      id: workspaceId,
      name: 'Workspace',
      timezone,
      lastBillDetectionAt,
    });
    await db.insert(schema.accounts).values({
      id: accountId,
      workspaceId,
      name: 'Account',
      type: AccountType.CHECKING,
    });
    await db.insert(schema.categories).values({
      id: categoryId,
      workspaceId,
      name: 'Moradia',
      type: TransactionType.EXPENSE,
    });

    return { workspaceId, accountId, categoryId };
  }

  async function seedBillTransactions(
    workspaceId: string,
    accountId: string,
    categoryId: string,
  ) {
    await db.insert(schema.transactions).values(
      ['2026-03-05', '2026-04-05', '2026-05-05'].map((day) => ({
        workspaceId,
        accountId,
        categoryId,
        title: 'Aluguel',
        amount: 150_000,
        date: new Date(`${day}T15:00:00.000Z`),
        type: TransactionType.EXPENSE,
        status: TransactionStatus.COMPLETED,
      })),
    );
  }

  const patternOf = (
    categoryId: string,
    accountId: string,
  ): DetectedBillSuggestion => ({
    categoryId,
    categoryName: 'Moradia',
    accountId,
    suggestedTitle: 'Moradia',
    amount: 150_000,
    dayOfMonth: 5,
    transactionIds: [],
  });

  async function lastDetectionAt(workspaceId: string): Promise<Date | null> {
    const [row] = await db
      .select({ lastBillDetectionAt: schema.workspaces.lastBillDetectionAt })
      .from(schema.workspaces)
      .where(eq(schema.workspaces.id, workspaceId));

    return row.lastBillDetectionAt;
  }

  async function countSuggestions(): Promise<number> {
    const [row] = await db
      .select({ count: sql<number>`COUNT(*)`.mapWith(Number) })
      .from(schema.recurringSuggestions);

    return row.count;
  }

  it('leaves the gate untouched when the detection transaction fails', async () => {
    const { workspaceId, accountId, categoryId } =
      await seedWorkspace('America/Sao_Paulo');

    await expect(
      repository.persistDetection({
        workspaceId,
        timezone: 'America/Sao_Paulo',
        now: NOW,
        patterns: [patternOf(categoryId, randomUUID())],
      }),
    ).rejects.toThrow();
    expect(await lastDetectionAt(workspaceId)).toBeNull();

    await expect(
      repository.persistDetection({
        workspaceId,
        timezone: 'America/Sao_Paulo',
        now: NOW,
        patterns: [patternOf(categoryId, accountId)],
      }),
    ).resolves.toBe('persisted');

    expect((await lastDetectionAt(workspaceId))?.toISOString()).toBe(
      NOW.toISOString(),
    );
    expect(await countSuggestions()).toBe(1);
  });

  it('persists once for two concurrent detections of the same workspace', async () => {
    const { workspaceId, accountId, categoryId } =
      await seedWorkspace('America/Sao_Paulo');
    const input = {
      workspaceId,
      timezone: 'America/Sao_Paulo',
      now: NOW,
      patterns: [patternOf(categoryId, accountId)],
    };

    const outcomes = await Promise.all([
      repository.persistDetection(input),
      repository.persistDetection(input),
    ]);

    expect([...outcomes].sort()).toEqual(['not-due', 'persisted']);
    expect(await countSuggestions()).toBe(1);
  });

  it('bumps the ledger generation once for two concurrent detections', async () => {
    const { workspaceId, accountId, categoryId } =
      await seedWorkspace('America/Sao_Paulo');
    await seedBillTransactions(workspaceId, accountId, categoryId);
    const bump = jest.spyOn(cache, 'incrementCounter');

    const outcomes = await Promise.all([
      detection.execute(workspaceId),
      detection.execute(workspaceId),
    ]);

    expect([...outcomes].sort()).toEqual(['not-due', 'persisted']);
    expect(bump).toHaveBeenCalledTimes(1);
    expect(bump).toHaveBeenCalledWith(
      ledgerGenerationKey(workspaceId),
      expect.any(Number),
    );
  });

  it('filters the due set per workspace timezone at one instant', async () => {
    const kiritimati = await seedWorkspace(
      'Pacific/Kiritimati',
      LAST_DETECTION,
    );
    const midway = await seedWorkspace('Pacific/Midway', LAST_DETECTION);

    const summary = await job.execute();

    expect(summary).toMatchObject({
      scanned: 1,
      persisted: 0,
      unchanged: 1,
      notDue: 0,
      failed: 0,
      failedWorkspaceIds: [],
    });
    expect((await lastDetectionAt(kiritimati.workspaceId))?.toISOString()).toBe(
      NOW.toISOString(),
    );
    expect((await lastDetectionAt(midway.workspaceId))?.toISOString()).toBe(
      LAST_DETECTION.toISOString(),
    );
  });

  it('counts a broken workspace as failed and logs its id', async () => {
    const broken = await seedWorkspace('Invalid/Zone', LAST_DETECTION);
    const spy = jest.spyOn(Logger.prototype, 'error').mockImplementation();
    errorSpy = spy;

    const summary = await job.execute();

    expect(summary).toMatchObject({
      scanned: 1,
      failed: 1,
      notDue: 0,
      failedWorkspaceIds: [broken.workspaceId],
      skipped: false,
    });
    expect(spy.mock.calls.flat().join(' ')).toContain(broken.workspaceId);
    expect((await lastDetectionAt(broken.workspaceId))?.toISOString()).toBe(
      LAST_DETECTION.toISOString(),
    );
  });
});
