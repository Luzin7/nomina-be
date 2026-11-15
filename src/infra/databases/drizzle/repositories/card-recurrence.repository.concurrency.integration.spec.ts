import {
  AccountType,
  RecurrenceFrequency,
  TransactionStatus,
  TransactionType,
} from '@constants/enums';
import { DrizzleService } from '@infra/databases/drizzle/drizzle.service';
import * as schema from '@infra/databases/drizzle/schema';
import {
  PostgreSqlContainer,
  StartedPostgreSqlContainer,
} from '@testcontainers/postgresql';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import postgres from 'postgres';
import { CardRecurrenceRepositoryImplementation } from './card-recurrence.repository';

type Database = ReturnType<typeof drizzle<typeof schema>>;
type RuleOverrides = Partial<typeof schema.recurringTransactions.$inferInsert>;

const MIGRATIONS_FOLDER = resolve(__dirname, '../../../../../drizzle');
const FROM = new Date('2026-12-01T00:00:00.000Z');
const TO = new Date('2027-06-01T00:00:00.000Z');

jest.setTimeout(180_000);

describe('CardRecurrenceRepositoryImplementation against a real postgres', () => {
  let container: StartedPostgreSqlContainer;
  let queryClient: postgres.Sql;
  let db: Database;
  let repository: CardRecurrenceRepositoryImplementation;
  let workspaceId: string;
  let cardId: string;
  let otherCardId: string;
  let checkingId: string;
  let categoryId: string;

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:17-alpine')
      .withStartupTimeout(120_000)
      .start();

    queryClient = postgres(container.getConnectionUri(), {
      max: 2,
      onnotice: () => undefined,
      connection: { TimeZone: 'UTC' },
    });
    db = drizzle(queryClient, { schema });

    await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });

    repository = new CardRecurrenceRepositoryImplementation({
      db,
    } as unknown as DrizzleService);
  });

  afterAll(async () => {
    await queryClient.end({ timeout: 5 });
    await container.stop();
  });

  beforeEach(async () => {
    await db.execute(
      sql`TRUNCATE workspaces, accounts, categories, transactions, recurring_transactions RESTART IDENTITY CASCADE`,
    );

    workspaceId = await insertWorkspace();
    cardId = await insertAccount(workspaceId, AccountType.CREDIT_CARD);
    otherCardId = await insertAccount(workspaceId, AccountType.CREDIT_CARD);
    checkingId = await insertAccount(workspaceId, AccountType.CHECKING);
    categoryId = randomUUID();
    await db.insert(schema.categories).values({
      id: categoryId,
      workspaceId,
      name: 'Assinaturas',
      type: TransactionType.EXPENSE,
    });
  });

  async function insertWorkspace(): Promise<string> {
    const id = randomUUID();
    await db.insert(schema.workspaces).values({ id, name: 'Workspace' });
    return id;
  }

  async function insertAccount(
    ownerWorkspaceId: string,
    type: AccountType,
  ): Promise<string> {
    const id = randomUUID();
    await db.insert(schema.accounts).values({
      id,
      workspaceId: ownerWorkspaceId,
      name: `Conta ${id}`,
      type,
      timezone: 'America/Sao_Paulo',
    });
    return id;
  }

  async function insertRule(overrides: RuleOverrides = {}): Promise<string> {
    const id = randomUUID();
    await db.insert(schema.recurringTransactions).values({
      id,
      workspaceId,
      accountId: cardId,
      type: TransactionType.EXPENSE,
      title: 'Assinatura',
      amount: 5000,
      frequency: RecurrenceFrequency.MONTHLY,
      startDate: new Date('2026-01-10T12:00:00.000Z'),
      ...overrides,
    });
    return id;
  }

  async function insertOccurrence(
    recurringId: string,
    date: Date,
    status: TransactionStatus = TransactionStatus.PENDING,
  ): Promise<void> {
    await db.insert(schema.transactions).values({
      workspaceId,
      accountId: cardId,
      categoryId,
      recurringId,
      title: 'Assinatura',
      amount: 5000,
      date,
      type: TransactionType.EXPENSE,
      status,
    });
  }

  async function findIds(): Promise<string[]> {
    const rules = await repository.findCardRecurrences({
      workspaceId,
      accountId: cardId,
      from: FROM,
      to: TO,
    });
    return rules.map((rule) => rule.id);
  }

  it('returns an active expense rule on the card', async () => {
    const ruleId = await insertRule();

    expect(await findIds()).toEqual([ruleId]);
  });

  it('excludes the rules of another card', async () => {
    await insertRule({ accountId: otherCardId });

    expect(await findIds()).toEqual([]);
  });

  it('excludes income rules', async () => {
    await insertRule({ type: TransactionType.INCOME });

    expect(await findIds()).toEqual([]);
  });

  it('excludes transfer rules', async () => {
    await insertRule({
      type: TransactionType.TRANSFER,
      destinationAccountId: checkingId,
    });
    await insertRule({ destinationAccountId: checkingId });

    expect(await findIds()).toEqual([]);
  });

  it('excludes inactive rules', async () => {
    await insertRule({ active: false });

    expect(await findIds()).toEqual([]);
  });

  it('excludes rules that ended before from and keeps the ones ending on from', async () => {
    await insertRule({ endDate: new Date('2026-11-30T23:59:59.000Z') });
    const endingOnFrom = await insertRule({ endDate: FROM });

    expect(await findIds()).toEqual([endingOnFrom]);
  });

  it('excludes rules of another workspace', async () => {
    const otherWorkspaceId = await insertWorkspace();
    const foreignCardId = await insertAccount(
      otherWorkspaceId,
      AccountType.CREDIT_CARD,
    );
    await insertRule({
      workspaceId: otherWorkspaceId,
      accountId: foreignCardId,
    });

    const rules = await repository.findCardRecurrences({
      workspaceId,
      accountId: foreignCardId,
      from: FROM,
      to: TO,
    });

    expect(rules).toEqual([]);
  });

  it('bounds materialized dates to [from, to) for any status', async () => {
    const ruleId = await insertRule();
    const pending = new Date('2026-12-10T12:00:00.000Z');
    const completed = new Date('2027-01-10T12:00:00.000Z');
    await insertOccurrence(ruleId, new Date('2026-11-30T23:59:59.000Z'));
    await insertOccurrence(ruleId, FROM);
    await insertOccurrence(ruleId, pending);
    await insertOccurrence(ruleId, completed, TransactionStatus.COMPLETED);
    await insertOccurrence(ruleId, TO);

    const [rule] = await repository.findCardRecurrences({
      workspaceId,
      accountId: cardId,
      from: FROM,
      to: TO,
    });

    expect(rule.materializedDates).toEqual([FROM, pending, completed]);
  });

  it('keeps materialized dates separate per rule', async () => {
    const first = await insertRule();
    const second = await insertRule();
    const date = new Date('2026-12-15T12:00:00.000Z');
    await insertOccurrence(first, date);

    const rules = await repository.findCardRecurrences({
      workspaceId,
      accountId: cardId,
      from: FROM,
      to: TO,
    });

    expect(rules.find((rule) => rule.id === first)?.materializedDates).toEqual([
      date,
    ]);
    expect(rules.find((rule) => rule.id === second)?.materializedDates).toEqual(
      [],
    );
  });
});
