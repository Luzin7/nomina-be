import { UserRole } from '@constants/enums';
import { DRIZZLE_TOKEN } from '@infra/databases/drizzle/drizzle.provider';
import { DrizzleService } from '@infra/databases/drizzle/drizzle.service';
import * as schema from '@infra/databases/drizzle/schema';
import { buildDefaultCategories } from '@modules/category/constants/default-categories';
import { EMERGENCY_GOAL_NAME } from '@modules/goal/constants/goal';
import { GoalRepository } from '@modules/goal/repositories/contracts/GoalRepository';
import { Workspace } from '@modules/workspace/entities/Workspace';
import { WorkspaceUser } from '@modules/workspace/entities/WorkspaceUser';
import { Test, TestingModule } from '@nestjs/testing';
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
import { WorkspaceRepositoryImplementation } from './workspace.repository';

const MIGRATIONS_FOLDER = resolve(__dirname, '../../../../../drizzle');

jest.setTimeout(180_000);

describe('emergency goal seed on workspace creation', () => {
  let container: StartedPostgreSqlContainer;
  let queryClient: postgres.Sql;
  let moduleRef: TestingModule;
  let db: DrizzleService['db'];
  let workspaceRepository: WorkspaceRepositoryImplementation;
  let goalRepository: GoalRepository;

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
        WorkspaceRepositoryImplementation,
        {
          provide: GoalRepository,
          useClass: GoalRepositoryImplementation,
        },
      ],
    }).compile();

    db = moduleRef.get(DrizzleService).db;
    workspaceRepository = moduleRef.get(WorkspaceRepositoryImplementation);
    goalRepository = moduleRef.get(GoalRepository);
  });

  afterAll(async () => {
    await moduleRef?.close();
    await queryClient?.end({ timeout: 5 });
    await container?.stop();
  });

  beforeEach(async () => {
    await db.execute(
      sql`TRUNCATE users, workspaces, workspace_users, accounts, categories, balance_movements, goals, subscriptions RESTART IDENTITY CASCADE`,
    );
  });

  async function createWorkspace(): Promise<string> {
    const userId = randomUUID();
    await db.insert(schema.users).values({
      id: userId,
      email: `${userId}@example.com`,
      passwordHash: 'hash',
      name: 'Owner',
    });

    const workspace = Workspace.create(
      { name: 'Casa', timezone: 'UTC' },
      randomUUID(),
    );
    if (workspace.isLeft()) throw workspace.value;

    const owner = WorkspaceUser.create(
      {
        workspaceId: workspace.value.id,
        userId,
        role: UserRole.OWNER,
        isDefault: false,
      },
      randomUUID(),
    );
    if (owner.isLeft()) throw owner.value;

    await workspaceRepository.createWithOwnerAndAccount(
      workspace.value,
      owner.value,
      buildDefaultCategories(workspace.value.id),
    );

    return workspace.value.id;
  }

  async function goalsOf(workspaceId: string) {
    return db
      .select()
      .from(schema.goals)
      .where(eq(schema.goals.workspaceId, workspaceId));
  }

  it('creates the unconfigured emergency goal with the workspace', async () => {
    const workspaceId = await createWorkspace();
    const goals = await goalsOf(workspaceId);

    expect(goals).toHaveLength(1);
    expect(goals[0]).toMatchObject({
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

  it('does not duplicate the goal when the lazy seed runs afterwards', async () => {
    const workspaceId = await createWorkspace();

    await goalRepository.seedEmergencyGoal(workspaceId);

    expect(await goalsOf(workspaceId)).toHaveLength(1);
  });
});
