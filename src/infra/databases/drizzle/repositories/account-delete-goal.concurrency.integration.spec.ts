import { DrizzleService } from '@infra/databases/drizzle/drizzle.service';
import * as schema from '@infra/databases/drizzle/schema';
import {
  GoalLinkedAccountInvalidError,
  LinkedAccountAlreadyTrackedError,
} from '@modules/goal/errors';
import { GoalProgressSource } from '@constants/enums';
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
import { AccountRepositoryImplementation } from './account.repository';
import { GoalRepositoryImplementation } from './goal.repository';

type Database = ReturnType<typeof drizzle<typeof schema>>;

const MIGRATIONS_FOLDER = resolve(__dirname, '../../../../../drizzle');
const ACCOUNT_ID = 'acc-delete-goal';

jest.setTimeout(180_000);

describe('account delete converting account-sourced goals', () => {
  let container: StartedPostgreSqlContainer;
  let queryClient: postgres.Sql;
  let db: Database;
  let accounts: AccountRepositoryImplementation;
  let goals: GoalRepositoryImplementation;
  let workspaceId: string;

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:16-alpine')
      .withStartupTimeout(120_000)
      .start();
    queryClient = postgres(container.getConnectionUri(), {
      max: 10,
      onnotice: () => undefined,
      connection: { TimeZone: 'UTC' },
    });
    db = drizzle(queryClient, { schema });
    await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });

    const drizzleService = { db } as unknown as DrizzleService;
    accounts = new AccountRepositoryImplementation(drizzleService);
    goals = new GoalRepositoryImplementation(drizzleService);
  });

  afterAll(async () => {
    await queryClient.end({ timeout: 5 });
    await container.stop();
  });

  beforeEach(async () => {
    await db.execute(
      sql`TRUNCATE users, workspaces, accounts, categories, goals RESTART IDENTITY CASCADE`,
    );
    workspaceId = randomUUID();
    await db.insert(schema.workspaces).values({ id: workspaceId, name: 'WS' });
  });

  async function seedAccount(balance: number, id = ACCOUNT_ID): Promise<void> {
    await db.insert(schema.accounts).values({
      id,
      workspaceId,
      name: `Conta ${id}`,
      type: 'CASH',
      balance,
    });
  }

  async function seedGoal(
    overrides: Partial<typeof schema.goals.$inferInsert> = {},
  ): Promise<string> {
    const id = randomUUID();
    await db.insert(schema.goals).values({
      id,
      workspaceId,
      name: 'Meta',
      targetCents: 100_000,
      currentCents: 10,
      linkedAccountId: ACCOUNT_ID,
      ...overrides,
    });
    return id;
  }

  async function readGoal(id: string) {
    const [row] = await db
      .select()
      .from(schema.goals)
      .where(eq(schema.goals.id, id));
    return row;
  }

  async function accountExists(): Promise<boolean> {
    const rows = await db
      .select({ id: schema.accounts.id })
      .from(schema.accounts)
      .where(eq(schema.accounts.id, ACCOUNT_ID));
    return rows.length === 1;
  }

  it('converts an account-sourced goal to manual with the balance snapshot', async () => {
    await seedAccount(12_345);
    const id = await seedGoal({ progressSource: GoalProgressSource.ACCOUNT });

    await accounts.delete(ACCOUNT_ID);

    expect(await readGoal(id)).toMatchObject({
      progressSource: 'manual',
      currentCents: 12_345,
      linkedAccountId: null,
    });
    expect(await accountExists()).toBe(false);
  });

  it('snapshots a negative balance as zero', async () => {
    await seedAccount(-800);
    const id = await seedGoal({ progressSource: GoalProgressSource.ACCOUNT });

    await accounts.delete(ACCOUNT_ID);

    expect(await readGoal(id)).toMatchObject({
      progressSource: 'manual',
      currentCents: 0,
      linkedAccountId: null,
    });
  });

  it('only unlinks a manual goal and keeps its stored amount', async () => {
    await seedAccount(12_345);
    const id = await seedGoal({ currentCents: 4_200 });

    await accounts.delete(ACCOUNT_ID);

    expect(await readGoal(id)).toMatchObject({
      progressSource: 'manual',
      currentCents: 4_200,
      linkedAccountId: null,
    });
  });

  it('is a no-op for an account that is already gone', async () => {
    await expect(accounts.delete(ACCOUNT_ID)).resolves.toBeUndefined();
  });

  it('rejects a second account-sourced goal on the same account with the named error', async () => {
    await seedAccount(500);
    await seedGoal({ progressSource: GoalProgressSource.ACCOUNT });

    await expect(
      goals.create({
        workspaceId,
        name: 'Outra',
        targetCents: 1_000,
        linkedAccountId: ACCOUNT_ID,
        progressSource: GoalProgressSource.ACCOUNT,
      }),
    ).rejects.toBeInstanceOf(LinkedAccountAlreadyTrackedError);
  });

  it('maps the unique violation raised by an update to the named error', async () => {
    await seedAccount(500);
    await seedGoal({ progressSource: GoalProgressSource.ACCOUNT });
    const other = await seedGoal({ linkedAccountId: null });

    await expect(
      goals.findByIdForUpdate(other, workspaceId, () => ({
        linkedAccountId: ACCOUNT_ID,
        progressSource: GoalProgressSource.ACCOUNT,
      })),
    ).rejects.toBeInstanceOf(LinkedAccountAlreadyTrackedError);
  });

  it('ends without a 500 when linking a goal races with the account delete', async () => {
    await seedAccount(7_000);
    const goalId = await seedGoal({
      linkedAccountId: null,
      progressSource: GoalProgressSource.MANUAL,
    });

    const [linked] = await Promise.allSettled([
      goals.findByIdForUpdate(goalId, workspaceId, () => ({
        linkedAccountId: ACCOUNT_ID,
        progressSource: GoalProgressSource.ACCOUNT,
      })),
      accounts.delete(ACCOUNT_ID),
    ]);

    const goal = await readGoal(goalId);
    expect(await accountExists()).toBe(false);
    expect(goal).toMatchObject({
      progressSource: 'manual',
      linkedAccountId: null,
    });
    if (linked.status === 'fulfilled') {
      expect(goal.currentCents).toBe(7_000);
      return;
    }
    expect(linked.reason).toBeInstanceOf(GoalLinkedAccountInvalidError);
  });

  it('does not deadlock when a goal update and the account delete overlap', async () => {
    await seedAccount(3_000);
    const goalId = await seedGoal({
      progressSource: GoalProgressSource.ACCOUNT,
    });

    const results = await Promise.allSettled(
      Array.from({ length: 5 }, (_, index) =>
        index === 0
          ? accounts.delete(ACCOUNT_ID)
          : goals.findByIdForUpdate(goalId, workspaceId, () => ({
              monthlyAporteCents: index,
            })),
      ),
    );

    const failures = results.filter((result) => result.status === 'rejected');
    expect(failures).toEqual([]);
    expect(await accountExists()).toBe(false);
  });

  it('waits on the goal lock before touching the account row', async () => {
    await seedAccount(3_000);
    const goalId = await seedGoal({
      progressSource: GoalProgressSource.ACCOUNT,
    });
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const holder = db.transaction(async (tx) => {
      await tx
        .select({ id: schema.goals.id })
        .from(schema.goals)
        .where(eq(schema.goals.id, goalId))
        .for('update');
      await held;
    });
    await new Promise((resolve) => setTimeout(resolve, 200));

    const deletion = accounts.delete(ACCOUNT_ID);
    await new Promise((resolve) => setTimeout(resolve, 300));

    const probe = await db
      .select({ id: schema.accounts.id })
      .from(schema.accounts)
      .where(eq(schema.accounts.id, ACCOUNT_ID))
      .for('update', { noWait: true });
    release();
    await holder;
    await deletion;

    expect(probe).toHaveLength(1);
    expect(await accountExists()).toBe(false);
  });
});
