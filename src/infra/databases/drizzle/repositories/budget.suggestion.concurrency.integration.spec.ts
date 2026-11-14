import { TransactionStatus, TransactionType } from '@constants/enums';
import { DrizzleService } from '@infra/databases/drizzle/drizzle.service';
import * as schema from '@infra/databases/drizzle/schema';
import { getErrorDetails } from '@shared/utils/error-details';
import { SYSTEM_CATEGORY } from '@modules/category/constants/system-categories';
import {
  SaveSnapshotWithDecisionInput,
  SuggestionDecisionInput,
} from '@modules/budget/repositories/contracts/BudgetRepository';
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
import { BudgetRepositoryImplementation } from './budget.repository';

type Database = ReturnType<typeof drizzle<typeof schema>>;

const MIGRATIONS_FOLDER = resolve(__dirname, '../../../../../drizzle');

const JANUARY = new Date('2026-01-01T00:00:00.000Z');
const MARCH = new Date('2026-03-01T00:00:00.000Z');
const FEBRUARY_DAY = new Date('2026-02-10T12:00:00.000Z');

const LOCK_NOT_AVAILABLE = '55P03';

jest.setTimeout(180_000);

describe('budget suggestion writes against a real postgres', () => {
  let container: StartedPostgreSqlContainer;
  let queryClient: postgres.Sql;
  let db: Database;
  let repository: BudgetRepositoryImplementation;
  let workspaceId: string;
  let otherWorkspaceId: string;
  let accountId: string;
  let categoryId: string;

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

    repository = new BudgetRepositoryImplementation(new DrizzleService(db));
  });

  afterAll(async () => {
    await queryClient.end({ timeout: 5 });
    await container.stop();
  });

  beforeEach(async () => {
    await db.execute(sql`TRUNCATE workspaces RESTART IDENTITY CASCADE`);

    workspaceId = randomUUID();
    otherWorkspaceId = randomUUID();
    accountId = randomUUID();
    categoryId = randomUUID();

    await db.insert(schema.workspaces).values([
      { id: workspaceId, name: 'Workspace' },
      { id: otherWorkspaceId, name: 'Other workspace' },
    ]);
    await db.insert(schema.accounts).values({
      id: accountId,
      workspaceId,
      name: 'Conta',
      type: 'CHECKING',
    });
    await db.insert(schema.categories).values([
      {
        id: categoryId,
        workspaceId,
        name: 'Moradia',
        type: TransactionType.EXPENSE,
      },
      ...Object.values(SYSTEM_CATEGORY).map((category) => ({
        id: category.id,
        workspaceId: null,
        name: category.name,
        type: category.type,
        isSystemCategory: true,
      })),
    ]);
  });

  const decisionOf = (
    overrides: Partial<SuggestionDecisionInput> = {},
  ): SuggestionDecisionInput => ({
    workspaceId,
    kind: 'income',
    month: '2026-03',
    decision: 'accepted',
    incomeCents: 500_000,
    bracketVersion: null,
    ...overrides,
  });

  const incomeAcceptOf = (
    overrides: Partial<SaveSnapshotWithDecisionInput> = {},
  ): SaveSnapshotWithDecisionInput => ({
    workspaceId,
    effectiveFrom: MARCH,
    expectedMonthlyIncome: null,
    decision: decisionOf(),
    write: { kind: 'income', monthlyIncome: 500_000 },
    isStillCurrent: async () => true,
    ...overrides,
  });

  const splitAcceptOf = (
    overrides: Partial<SaveSnapshotWithDecisionInput> = {},
  ): SaveSnapshotWithDecisionInput => ({
    workspaceId,
    effectiveFrom: MARCH,
    expectedMonthlyIncome: null,
    decision: decisionOf({ kind: 'split', incomeCents: null }),
    write: {
      kind: 'split',
      allocations: [
        {
          categoryId,
          groupName: 'Essenciais',
          groupOrder: 0,
          categoryOrder: 0,
          targetCents: 100_000,
        },
      ],
    },
    isStillCurrent: async () => true,
    ...overrides,
  });

  async function snapshotsOf(id: string) {
    return db
      .select()
      .from(schema.budgets)
      .where(eq(schema.budgets.workspaceId, id));
  }

  async function decisionsOf(id: string) {
    return db
      .select()
      .from(schema.budgetSuggestionDecisions)
      .where(eq(schema.budgetSuggestionDecisions.workspaceId, id));
  }

  async function insertTransaction(
    overrides: Partial<typeof schema.transactions.$inferInsert>,
  ) {
    await db.insert(schema.transactions).values({
      id: randomUUID(),
      workspaceId,
      accountId,
      categoryId,
      title: 'Linha',
      amount: 10_000,
      date: FEBRUARY_DAY,
      type: TransactionType.EXPENSE,
      status: TransactionStatus.COMPLETED,
      ...overrides,
    });
  }

  it('keeps one snapshot and one decision when the same income accept runs twice in parallel', async () => {
    const outcomes = await Promise.all([
      repository.saveSnapshotWithDecision(incomeAcceptOf()),
      repository.saveSnapshotWithDecision(incomeAcceptOf()),
    ]);

    expect([...outcomes].sort()).toEqual(['already-decided', 'applied']);
    expect(await snapshotsOf(workspaceId)).toHaveLength(1);
    expect(await decisionsOf(workspaceId)).toHaveLength(1);
  });

  it('keeps one decision when the same rejection runs twice in parallel', async () => {
    const rejection = decisionOf({
      decision: 'rejected',
      incomeCents: null,
    });

    const outcomes = await Promise.all([
      repository.saveDecision(rejection),
      repository.saveDecision(rejection),
    ]);

    expect([...outcomes].sort()).toEqual(['already-decided', 'applied']);
    expect(await decisionsOf(workspaceId)).toHaveLength(1);
    expect(await snapshotsOf(workspaceId)).toHaveLength(0);
  });

  it('writes a positive income and never null on income accept', async () => {
    await repository.saveSnapshotWithDecision(incomeAcceptOf());

    const [snapshot] = await snapshotsOf(workspaceId);
    expect(snapshot.monthlyIncome).toBe(500_000);
  });

  it('refuses an income accept when a snapshot with income appeared meanwhile', async () => {
    await repository.saveSnapshot({
      workspaceId,
      effectiveFrom: JANUARY,
      monthlyIncome: 200_000,
      mode: 'percentage',
      allocations: [],
    });

    const outcome = await repository.saveSnapshotWithDecision(incomeAcceptOf());

    expect(outcome).toBe('drifted');
    expect(await decisionsOf(workspaceId)).toHaveLength(0);
    expect(await snapshotsOf(workspaceId)).toHaveLength(1);
  });

  it('leaves another workspace untouched when a workspace accepts', async () => {
    await repository.saveSnapshotWithDecision(
      incomeAcceptOf({
        workspaceId: otherWorkspaceId,
        decision: decisionOf({ workspaceId: otherWorkspaceId }),
      }),
    );

    expect(await snapshotsOf(workspaceId)).toHaveLength(0);
    expect(await decisionsOf(workspaceId)).toHaveLength(0);
    expect(await snapshotsOf(otherWorkspaceId)).toHaveLength(1);
    expect(await decisionsOf(otherWorkspaceId)).toHaveLength(1);
  });

  it('writes a null income only on split accept without an income basis', async () => {
    await repository.saveSnapshotWithDecision(splitAcceptOf());

    const [snapshot] = await snapshotsOf(workspaceId);
    expect(snapshot.monthlyIncome).toBeNull();
    expect(snapshot.mode).toBe('fixed');
  });

  it('keeps the snapshot income on split accept with an income basis', async () => {
    await repository.saveSnapshot({
      workspaceId,
      effectiveFrom: JANUARY,
      monthlyIncome: 400_000,
      mode: 'percentage',
      allocations: [],
    });

    const outcome = await repository.saveSnapshotWithDecision(
      splitAcceptOf({
        expectedMonthlyIncome: 400_000,
        decision: decisionOf({ kind: 'split', incomeCents: 400_000 }),
      }),
    );

    const snapshots = await snapshotsOf(workspaceId);
    const created = snapshots.find(
      (snapshot) => snapshot.effectiveFrom.getTime() === MARCH.getTime(),
    );
    expect(outcome).toBe('applied');
    expect(created?.monthlyIncome).toBe(400_000);
  });

  const seedIncomeSnapshot = (targetCents: number, effectiveFrom: Date) =>
    repository.saveSnapshot({
      workspaceId,
      effectiveFrom,
      monthlyIncome: 400_000,
      mode: 'fixed',
      allocations: [
        {
          categoryId,
          groupName: 'Essenciais',
          groupOrder: 0,
          categoryOrder: 0,
          percentageOfIncome: null,
          targetCents,
        },
      ],
    });

  const targetOfMarch = async () => {
    const snapshot = await repository.resolveSnapshot(workspaceId, MARCH);
    return snapshot?.allocations[0]?.targetCents;
  };

  const splitAcceptAgainstTarget = (seenTargetCents: number) =>
    splitAcceptOf({
      expectedMonthlyIncome: 400_000,
      decision: decisionOf({ kind: 'split', incomeCents: 400_000 }),
      isStillCurrent: async () => (await targetOfMarch()) === seenTargetCents,
    });

  it('drifts a split accept whose view of the targets is stale after the lock', async () => {
    await seedIncomeSnapshot(50_000, JANUARY);
    await seedIncomeSnapshot(777, MARCH);

    const outcome = await repository.saveSnapshotWithDecision(
      splitAcceptAgainstTarget(50_000),
    );

    expect(outcome).toBe('drifted');
    expect(await decisionsOf(workspaceId)).toHaveLength(0);
    expect(await targetOfMarch()).toBe(777);
  });

  it('never leaves stale targets when a split accept races save-config', async () => {
    await seedIncomeSnapshot(50_000, JANUARY);

    const [outcome] = await Promise.all([
      repository.saveSnapshotWithDecision(splitAcceptAgainstTarget(50_000)),
      seedIncomeSnapshot(777, MARCH),
    ]);

    expect(['applied', 'drifted']).toContain(outcome);
    expect(await targetOfMarch()).toBe(777);
  });

  it('completes an accept on a single-connection pool when the freshness check reads', async () => {
    const singleConnection = postgres(container.getConnectionUri(), {
      max: 1,
      onnotice: () => undefined,
      connection: { TimeZone: 'UTC' },
    });
    const singleRepository = new BudgetRepositoryImplementation(
      new DrizzleService(drizzle(singleConnection, { schema })),
    );

    const outcome = await singleRepository.saveSnapshotWithDecision(
      incomeAcceptOf({
        isStillCurrent: async () =>
          (await singleRepository.resolveSnapshot(workspaceId, MARCH)) === null,
      }),
    );
    await singleConnection.end({ timeout: 5 });

    expect(outcome).toBe('applied');
  }, 20_000);

  describe('when another session holds the workspace budget lock', () => {
    const holdingLock = (work: () => Promise<void>) =>
      queryClient.begin(async (tx) => {
        await tx`SELECT pg_advisory_xact_lock(hashtext(${workspaceId}))`;
        await work();
      });

    const sqlStateOf = async (write: Promise<unknown>) => {
      const error: unknown = await write.catch((caught: unknown) => caught);

      return getErrorDetails(error).sqlState;
    };

    it('fails the accept with a lock timeout instead of waiting', async () => {
      let sqlState: string | null = null;

      await holdingLock(async () => {
        sqlState = await sqlStateOf(
          repository.saveSnapshotWithDecision(incomeAcceptOf()),
        );
      });

      expect(sqlState).toBe(LOCK_NOT_AVAILABLE);
    });

    it('fails the rejection with a lock timeout instead of waiting', async () => {
      let sqlState: string | null = null;

      await holdingLock(async () => {
        sqlState = await sqlStateOf(
          repository.saveDecision(decisionOf({ decision: 'rejected' })),
        );
      });

      expect(sqlState).toBe(LOCK_NOT_AVAILABLE);
    });
  });

  it('excludes the credit card payment, investment income and transfers from the inference totals', async () => {
    const investmentsId = randomUUID();
    await db.insert(schema.categories).values({
      id: investmentsId,
      workspaceId,
      name: 'Investimentos',
      type: TransactionType.INCOME,
    });
    const salaryId = randomUUID();
    await db.insert(schema.categories).values({
      id: salaryId,
      workspaceId,
      name: 'Salario',
      type: TransactionType.INCOME,
    });

    await insertTransaction({ amount: 10_000 });
    await insertTransaction({
      amount: 90_000,
      categoryId: SYSTEM_CATEGORY.CREDIT_CARD_PAYMENT.id,
    });
    await insertTransaction({
      amount: 80_000,
      categoryId: SYSTEM_CATEGORY.TRANSFER.id,
      type: TransactionType.TRANSFER,
    });
    await insertTransaction({
      amount: 300_000,
      categoryId: salaryId,
      type: TransactionType.INCOME,
    });
    await insertTransaction({
      amount: 70_000,
      categoryId: investmentsId,
      type: TransactionType.INCOME,
    });

    const totals = await repository.findInferenceTotals({
      workspaceId,
      start: JANUARY,
      end: new Date('2026-03-31T23:59:59.999Z'),
      timezone: 'UTC',
    });

    expect(totals).toEqual([
      {
        month: '2026-02',
        incomeCents: 300_000,
        expenseByCategory: { [categoryId]: 10_000 },
      },
    ]);
  });
});
