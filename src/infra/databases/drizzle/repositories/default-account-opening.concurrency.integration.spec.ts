import { BalanceMovementCause, UserRole } from '@constants/enums';
import { DRIZZLE_TOKEN } from '@infra/databases/drizzle/drizzle.provider';
import { DrizzleService } from '@infra/databases/drizzle/drizzle.service';
import * as schema from '@infra/databases/drizzle/schema';
import { buildDefaultCategories } from '@modules/category/constants/default-categories';
import { ReconcileBalancesJobService } from '@modules/transaction/jobs/reconcile-balances/reconcile-balances.service';
import { User } from '@modules/user/entities/User';
import { Workspace } from '@modules/workspace/entities/Workspace';
import { WorkspaceUser } from '@modules/workspace/entities/WorkspaceUser';
import { Test, TestingModule } from '@nestjs/testing';
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
import { UserRepositoryImplementation } from './user.repository';
import { WorkspaceRepositoryImplementation } from './workspace.repository';

jest.mock('@sentry/nestjs', () => ({ captureException: jest.fn() }));

const MIGRATIONS_FOLDER = resolve(__dirname, '../../../../../drizzle');

jest.setTimeout(180_000);

describe('default account opening movement', () => {
  let container: StartedPostgreSqlContainer;
  let queryClient: postgres.Sql;
  let moduleRef: TestingModule;
  let db: DrizzleService['db'];
  let userRepository: UserRepositoryImplementation;
  let workspaceRepository: WorkspaceRepositoryImplementation;
  let reconcileService: ReconcileBalancesJobService;

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
        UserRepositoryImplementation,
        WorkspaceRepositoryImplementation,
        ReconcileBalancesJobService,
      ],
    }).compile();

    db = moduleRef.get(DrizzleService).db;
    userRepository = moduleRef.get(UserRepositoryImplementation);
    workspaceRepository = moduleRef.get(WorkspaceRepositoryImplementation);
    reconcileService = moduleRef.get(ReconcileBalancesJobService);
  });

  afterAll(async () => {
    await moduleRef?.close();
    await queryClient?.end({ timeout: 5 });
    await container?.stop();
  });

  beforeEach(async () => {
    await db.execute(
      sql`TRUNCATE users, accounts, balance_movements, workspaces, categories RESTART IDENTITY CASCADE`,
    );
  });

  function makeUser(): User {
    const user = User.create(
      {
        name: 'New User',
        email: `${randomUUID()}@example.com`,
        passwordHash: 'hash',
      },
      randomUUID(),
    );
    if (user.isLeft()) throw user.value;

    return user.value;
  }

  it("should not report a new user's default account as uncovered", async () => {
    const user = makeUser();
    await userRepository.create(user);

    const result = await reconcileService.execute();
    const movements = await db.select().from(schema.balanceMovements);

    expect(result).toEqual({
      accountsChecked: 1,
      uncovered: 0,
      divergences: [],
    });
    expect(movements).toHaveLength(1);
    expect(movements[0]).toMatchObject({
      cause: BalanceMovementCause.OPENING,
      delta: 0,
      balanceAfter: 0,
      actorId: user.id,
    });
  });

  it("should not report a new workspace's default account as uncovered", async () => {
    const user = makeUser();
    await userRepository.create(user);
    await db.execute(sql`TRUNCATE accounts, balance_movements CASCADE`);

    const workspace = Workspace.create(
      { name: 'Second', timezone: 'UTC' },
      randomUUID(),
    );
    if (workspace.isLeft()) throw workspace.value;
    const owner = WorkspaceUser.create(
      {
        workspaceId: workspace.value.id,
        userId: user.id,
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

    const result = await reconcileService.execute();
    const movements = await db.select().from(schema.balanceMovements);

    expect(result).toEqual({
      accountsChecked: 1,
      uncovered: 0,
      divergences: [],
    });
    expect(movements[0]).toMatchObject({
      cause: BalanceMovementCause.OPENING,
      delta: 0,
      actorId: user.id,
    });
  });
});
