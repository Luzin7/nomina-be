import { DrizzleService } from '@infra/databases/drizzle/drizzle.service';
import * as schema from '@infra/databases/drizzle/schema';
import { EMERGENCY_GOAL_NAME } from '@modules/goal/constants/goal';
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
import { GoalRepositoryImplementation } from './goal.repository';

type Database = ReturnType<typeof drizzle<typeof schema>>;

const MIGRATIONS_FOLDER = resolve(__dirname, '../../../../../drizzle');

jest.setTimeout(180_000);

describe('GoalRepositoryImplementation against a real postgres', () => {
  let container: StartedPostgreSqlContainer;
  let queryClient: postgres.Sql;
  let db: Database;
  let repository: GoalRepositoryImplementation;
  let workspaceId: string;

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

    repository = new GoalRepositoryImplementation({
      db,
    } as unknown as DrizzleService);
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
    await db.insert(schema.workspaces).values({
      id: workspaceId,
      name: 'Workspace',
    });
  });

  function makeGoal(
    overrides: Partial<typeof schema.goals.$inferInsert> = {},
  ): typeof schema.goals.$inferInsert {
    return {
      workspaceId,
      name: 'Meta',
      targetCents: 0,
      currentCents: 0,
      monthlyAporteCents: 0,
      ...overrides,
    };
  }

  async function goalCount(): Promise<number> {
    const [row] = await db
      .select({ count: sql<number>`COUNT(*)`.mapWith(Number) })
      .from(schema.goals)
      .where(eq(schema.goals.workspaceId, workspaceId));

    return row.count;
  }

  describe('sumMonthlyAporteCents', () => {
    it('counts only configured, undismissed and unreached aportes', async () => {
      await db.insert(schema.goals).values([
        makeGoal({ monthlyAporteCents: 500 }),
        makeGoal({ targetCents: 1_000, monthlyAporteCents: 300 }),
        makeGoal({
          targetCents: 1_000,
          monthlyAporteCents: 200,
          dismissedAt: new Date('2026-01-10T12:00:00.000Z'),
        }),
      ]);

      await expect(repository.sumMonthlyAporteCents(workspaceId)).resolves.toBe(
        300,
      );
    });

    it('stops counting a reached goal', async () => {
      await db.insert(schema.goals).values(
        makeGoal({
          targetCents: 1_000,
          currentCents: 1_000,
          monthlyAporteCents: 400,
        }),
      );

      await expect(repository.sumMonthlyAporteCents(workspaceId)).resolves.toBe(
        0,
      );
    });
  });

  describe('getSummaryAggregates', () => {
    it('aggregates totals and counts by target state', async () => {
      await db.insert(schema.goals).values([
        makeGoal({ targetCents: 0, currentCents: 0 }),
        makeGoal({ targetCents: 1_000, currentCents: 100 }),
        makeGoal({ targetCents: 100, currentCents: 100 }),
        makeGoal({
          targetCents: 1_000,
          currentCents: 0,
          dismissedAt: new Date('2026-01-10T12:00:00.000Z'),
        }),
      ]);

      await expect(
        repository.getSummaryAggregates(workspaceId),
      ).resolves.toEqual({
        totalTargetCents: 2_100,
        totalCurrentCents: 200,
        activeCount: 2,
        completedCount: 1,
        unsetTargetCount: 1,
      });
    });
  });

  describe('seedEmergencyGoal', () => {
    it('seeds an unconfigured emergency goal exactly once', async () => {
      await repository.seedEmergencyGoal(workspaceId);
      await repository.seedEmergencyGoal(workspaceId);

      const [goal] = await db
        .select()
        .from(schema.goals)
        .where(eq(schema.goals.workspaceId, workspaceId));

      expect(await goalCount()).toBe(1);
      expect(goal).toMatchObject({
        workspaceId,
        name: EMERGENCY_GOAL_NAME,
        targetCents: 0,
        currentCents: 0,
        monthlyAporteCents: 0,
        isEmergency: true,
        isSystem: true,
        dismissedAt: null,
      });
    });

    it('keeps a single row when two seeds run concurrently', async () => {
      await Promise.all([
        repository.seedEmergencyGoal(workspaceId),
        repository.seedEmergencyGoal(workspaceId),
      ]);

      expect(await goalCount()).toBe(1);
    });

    it('never clears a dismissed reserve', async () => {
      const dismissedAt = new Date('2026-01-10T12:00:00.000Z');

      await repository.seedEmergencyGoal(workspaceId);
      await db
        .update(schema.goals)
        .set({ dismissedAt })
        .where(eq(schema.goals.workspaceId, workspaceId));
      await repository.seedEmergencyGoal(workspaceId);

      const [goal] = await db
        .select()
        .from(schema.goals)
        .where(eq(schema.goals.workspaceId, workspaceId));

      expect(await goalCount()).toBe(1);
      expect(goal.dismissedAt).toEqual(dismissedAt);
    });
  });
});
