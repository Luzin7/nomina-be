import {
  AccountType,
  RecurringSuggestionStatus,
  TransactionStatus,
  TransactionType,
} from '@constants/enums';
import { DrizzleService } from '@infra/databases/drizzle/drizzle.service';
import * as schema from '@infra/databases/drizzle/schema';
import { makeRecurring } from '@modules/transaction/test-helpers/mock-factories';
import {
  billDetectionWindow,
  detectBillSuggestions,
} from '@modules/transaction/valueObjects/BillSuggestionDetection';
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
import { RecurringSuggestionRepositoryImplementation } from './recurring-suggestion.repository';

type Database = ReturnType<typeof drizzle<typeof schema>>;

const MIGRATIONS_FOLDER = resolve(__dirname, '../../../../../drizzle');
const TIMEZONE = 'America/Sao_Paulo';
const NOW = new Date('2026-11-09T15:00:00.000Z');
const dateProvider = new DayJsDateProvider();

const BILL_DAYS = [
  new Date('2026-08-05T15:00:00.000Z'),
  new Date('2026-09-05T15:00:00.000Z'),
  new Date('2026-10-05T15:00:00.000Z'),
];

jest.setTimeout(180_000);

describe('RecurringSuggestionRepositoryImplementation against a real postgres', () => {
  let container: StartedPostgreSqlContainer;
  let queryClient: postgres.Sql;
  let db: Database;
  let repository: RecurringSuggestionRepositoryImplementation;

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

    repository = new RecurringSuggestionRepositoryImplementation(
      { db } as unknown as DrizzleService,
      dateProvider,
    );
  });

  afterAll(async () => {
    await queryClient.end({ timeout: 5 });
    await container.stop();
  });

  beforeEach(async () => {
    await db.execute(
      sql`TRUNCATE workspaces, categories, accounts, transactions,
        recurring_transactions, recurring_suggestions,
        recurring_suggestion_transactions RESTART IDENTITY CASCADE`,
    );
  });

  async function seedWorkspace() {
    const workspaceId = randomUUID();
    const accountId = randomUUID();
    const categoryId = randomUUID();

    await db.insert(schema.workspaces).values({
      id: workspaceId,
      name: 'Workspace',
      timezone: TIMEZONE,
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
      BILL_DAYS.map((date) => ({
        workspaceId,
        accountId,
        categoryId,
        title: 'Aluguel',
        amount: 150_000,
        date,
        type: TransactionType.EXPENSE,
        status: TransactionStatus.COMPLETED,
      })),
    );
  }

  async function runDetection(workspaceId: string) {
    const window = billDetectionWindow(NOW, TIMEZONE, dateProvider);
    const transactions = await repository.findBillCandidates({
      workspaceId,
      timezone: TIMEZONE,
      from: window.from,
      to: window.to,
    });
    const patterns = detectBillSuggestions({
      months: window.months,
      transactions,
      activeRules: [],
    });

    await repository.persistDetection({
      workspaceId,
      timezone: TIMEZONE,
      now: NOW,
      patterns,
    });

    return patterns;
  }

  async function countRows(
    table:
      | typeof schema.recurringSuggestions
      | typeof schema.recurringSuggestionTransactions
      | typeof schema.recurringTransactions,
  ): Promise<number> {
    const [row] = await db
      .select({ count: sql<number>`COUNT(*)`.mapWith(Number) })
      .from(table);

    return row.count;
  }

  it('keeps one suggestion and one link per transaction when detection runs twice', async () => {
    const { workspaceId, accountId, categoryId } = await seedWorkspace();
    await seedBillTransactions(workspaceId, accountId, categoryId);

    const patterns = await runDetection(workspaceId);
    const [firstView] = await repository.findPendingByWorkspace(workspaceId);

    await db
      .update(schema.workspaces)
      .set({ lastBillDetectionAt: null })
      .where(eq(schema.workspaces.id, workspaceId));
    await runDetection(workspaceId);
    const [secondView] = await repository.findPendingByWorkspace(workspaceId);

    expect(patterns).toHaveLength(1);
    expect(await countRows(schema.recurringSuggestions)).toBe(1);
    expect(secondView.suggestion.id).toBe(firstView.suggestion.id);
    expect(await countRows(schema.recurringSuggestionTransactions)).toBe(
      patterns[0].transactionIds.length,
    );
  });

  it('refreshes account and title when the pattern moves', async () => {
    const { workspaceId, accountId, categoryId } = await seedWorkspace();
    const otherAccountId = randomUUID();
    await db.insert(schema.accounts).values({
      id: otherAccountId,
      workspaceId,
      name: 'Conta nova',
      type: AccountType.CHECKING,
    });
    await seedBillTransactions(workspaceId, accountId, categoryId);
    await runDetection(workspaceId);
    const [firstView] = await repository.findPendingByWorkspace(workspaceId);

    await db
      .update(schema.transactions)
      .set({ accountId: otherAccountId })
      .where(eq(schema.transactions.workspaceId, workspaceId));
    await db
      .update(schema.categories)
      .set({ name: 'Aluguel' })
      .where(eq(schema.categories.id, categoryId));
    await db
      .update(schema.workspaces)
      .set({ lastBillDetectionAt: null })
      .where(eq(schema.workspaces.id, workspaceId));
    await runDetection(workspaceId);
    const [secondView] = await repository.findPendingByWorkspace(workspaceId);

    expect(secondView.suggestion.id).toBe(firstView.suggestion.id);
    expect(secondView.suggestion.accountId).toBe(otherAccountId);
    expect(secondView.suggestion.suggestedTitle).toBe('Aluguel');
    expect(secondView.accountName).toBe('Conta nova');
  });

  it('creates exactly one rule for two concurrent accepts', async () => {
    const { workspaceId, accountId, categoryId } = await seedWorkspace();
    await seedBillTransactions(workspaceId, accountId, categoryId);
    await runDetection(workspaceId);
    const [view] = await repository.findPendingByWorkspace(workspaceId);

    const rule = () =>
      makeRecurring({
        workspaceId,
        accountId,
        categoryId,
        amount: 150_000n,
        startDate: new Date('2026-12-05T03:00:00.000Z'),
      });

    const [left, right] = await Promise.all([
      repository.accept({
        suggestionId: view.suggestion.id,
        workspaceId,
        rule: rule(),
      }),
      repository.accept({
        suggestionId: view.suggestion.id,
        workspaceId,
        rule: rule(),
      }),
    ]);

    const recurringIds = [left, right].map((outcome) => {
      if (outcome.kind === 'accepted' || outcome.kind === 'already-accepted') {
        return outcome.recurringId;
      }
      throw new Error(`unexpected outcome: ${outcome.kind}`);
    });

    expect(new Set(recurringIds).size).toBe(1);
    expect(await countRows(schema.recurringTransactions)).toBe(1);

    const [suggestion] = await db
      .select()
      .from(schema.recurringSuggestions)
      .where(eq(schema.recurringSuggestions.id, view.suggestion.id));

    expect(suggestion.status).toBe(RecurringSuggestionStatus.ACCEPTED);
    expect(suggestion.recurringId).toBe(recurringIds[0]);
  });

  it('writes nothing when accepting from another workspace', async () => {
    const { workspaceId, accountId, categoryId } = await seedWorkspace();
    await seedBillTransactions(workspaceId, accountId, categoryId);
    await runDetection(workspaceId);
    const [view] = await repository.findPendingByWorkspace(workspaceId);

    const otherWorkspaceId = randomUUID();
    await db.insert(schema.workspaces).values({
      id: otherWorkspaceId,
      name: 'Other',
      timezone: TIMEZONE,
    });

    const outcome = await repository.accept({
      suggestionId: view.suggestion.id,
      workspaceId: otherWorkspaceId,
      rule: makeRecurring({
        workspaceId: otherWorkspaceId,
        accountId,
        categoryId,
        amount: 150_000n,
        startDate: new Date('2026-12-05T03:00:00.000Z'),
      }),
    });

    expect(outcome).toEqual({ kind: 'not-found' });
    expect(await countRows(schema.recurringTransactions)).toBe(0);

    const [suggestion] = await db
      .select()
      .from(schema.recurringSuggestions)
      .where(eq(schema.recurringSuggestions.id, view.suggestion.id));

    expect(suggestion.status).toBe(RecurringSuggestionStatus.PENDING);
    expect(suggestion.recurringId).toBeNull();
  });
});
