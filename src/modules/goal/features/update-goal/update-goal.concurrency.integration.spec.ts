import { CacheProvider } from '@infra/cache/contracts/CacheProvider';
import { DRIZZLE_TOKEN } from '@infra/databases/drizzle/drizzle.provider';
import { DrizzleService } from '@infra/databases/drizzle/drizzle.service';
import { AccountRepositoryImplementation } from '@infra/databases/drizzle/repositories/account.repository';
import { CategoryRepositoryImplementation } from '@infra/databases/drizzle/repositories/category.repository';
import { GoalRepositoryImplementation } from '@infra/databases/drizzle/repositories/goal.repository';
import { WorkspaceRepositoryImplementation } from '@infra/databases/drizzle/repositories/workspace.repository';
import * as schema from '@infra/databases/drizzle/schema';
import { AccountRepository } from '@modules/account/repositories/contracts/AccountRepository';
import { CategoryRepository } from '@modules/category/repositories/contracts/CategoryRepository';
import { GoalRepository } from '@modules/goal/repositories/contracts/GoalRepository';
import { ValidateGoalLinksService } from '@modules/goal/services/validate-goal-links.service';
import { WorkspaceRepository } from '@modules/workspace/repositories/contracts/WorkspaceRepository';
import { GetWorkspaceTimezoneService } from '@modules/workspace/services/get-workspace-timezone.service';
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
import { UpdateGoalRequest } from './update-goal.dto';
import { UpdateGoalResponse, UpdateGoalService } from './update-goal.service';

const MIGRATIONS_FOLDER = resolve(__dirname, '../../../../../drizzle');
const TARGET_CENTS = 600_000;
const APORTE_CENTS = 200_000;
const FUNDED_CENTS = 550_000;
const LOCK_WAITERS = 2;
const LOCK_POLL_ATTEMPTS = 200;
const LOCK_POLL_INTERVAL_MS = 20;

jest.setTimeout(180_000);

describe('concurrent goal patches against a real postgres', () => {
  let container: StartedPostgreSqlContainer;
  let connectionUri: string;
  let queryClient: postgres.Sql;
  let lockClient: postgres.Sql;
  let moduleRef: TestingModule;
  let db: DrizzleService['db'];
  let service: UpdateGoalService;
  let workspaceId: string;
  let goalId: string;

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:16-alpine')
      .withStartupTimeout(120_000)
      .start();

    connectionUri = container.getConnectionUri();
    queryClient = postgres(connectionUri, {
      max: 5,
      onnotice: () => undefined,
      connection: { TimeZone: 'UTC' },
    });
    lockClient = postgres(connectionUri, {
      max: 1,
      onnotice: () => undefined,
      connection: { TimeZone: 'UTC' },
    });
    const drizzleDb = drizzle(queryClient, { schema });
    await migrate(drizzleDb, { migrationsFolder: MIGRATIONS_FOLDER });

    moduleRef = await Test.createTestingModule({
      providers: [
        DrizzleService,
        { provide: DRIZZLE_TOKEN, useValue: drizzleDb },
        {
          provide: GoalRepository,
          useClass: GoalRepositoryImplementation,
        },
        {
          provide: AccountRepository,
          useClass: AccountRepositoryImplementation,
        },
        {
          provide: CategoryRepository,
          useClass: CategoryRepositoryImplementation,
        },
        {
          provide: WorkspaceRepository,
          useClass: WorkspaceRepositoryImplementation,
        },
        {
          provide: CacheProvider,
          useValue: {
            get: async () => null,
            set: async () => true,
          },
        },
        { provide: DateProvider, useClass: DayJsDateProvider },
        ValidateGoalLinksService,
        GetWorkspaceTimezoneService,
        UpdateGoalService,
      ],
    }).compile();

    db = moduleRef.get(DrizzleService).db;
    service = moduleRef.get(UpdateGoalService);
  });

  afterAll(async () => {
    await moduleRef?.close();
    await lockClient?.end({ timeout: 5 });
    await queryClient?.end({ timeout: 5 });
    await container?.stop();
  });

  beforeEach(async () => {
    await db.execute(
      sql`TRUNCATE users, workspaces, workspace_users, accounts, categories, balance_movements, goals RESTART IDENTITY CASCADE`,
    );

    workspaceId = randomUUID();
    goalId = randomUUID();
    await db.insert(schema.workspaces).values({
      id: workspaceId,
      name: 'Casa',
    });
    await db.insert(schema.goals).values({
      id: goalId,
      workspaceId,
      name: 'Viagem',
      targetCents: TARGET_CENTS,
      currentCents: 0,
      monthlyAporteCents: APORTE_CENTS,
    });
  });

  async function patch(body: UpdateGoalRequest): Promise<UpdateGoalResponse> {
    const result = await service.execute({ id: goalId, workspaceId, ...body });

    if (result.isLeft()) throw result.value;

    return result.value;
  }

  async function currentGoal() {
    const [row] = await db
      .select()
      .from(schema.goals)
      .where(eq(schema.goals.id, goalId));

    return row;
  }

  function expectedEtaMonths(currentCents: number): number | null {
    const remaining = TARGET_CENTS - currentCents;

    return remaining > 0 ? Math.ceil(remaining / APORTE_CENTS) : null;
  }

  async function waitForLockedPatches(): Promise<void> {
    for (let attempt = 0; attempt < LOCK_POLL_ATTEMPTS; attempt += 1) {
      const [row] = await queryClient<
        { waiting: number }[]
      >`SELECT count(*)::int AS waiting FROM pg_stat_activity WHERE wait_event_type = 'Lock'`;

      if (row.waiting >= LOCK_WAITERS) return;

      await new Promise((resolve) =>
        setTimeout(resolve, LOCK_POLL_INTERVAL_MS),
      );
    }

    throw new Error('the patches never waited for the goal row lock');
  }

  it('serializes two patches into one final state with a matching ETA', async () => {
    let releaseLock: () => void = () => undefined;
    let lockAcquired: () => void = () => undefined;
    const lockReleased = new Promise<void>((resolve) => {
      releaseLock = resolve;
    });
    const acquired = new Promise<void>((resolve) => {
      lockAcquired = resolve;
    });

    const holder = lockClient.begin(async (tx) => {
      await tx`SELECT id FROM goals WHERE id = ${goalId} FOR UPDATE`;
      await tx`UPDATE goals SET current_cents = ${FUNDED_CENTS} WHERE id = ${goalId}`;
      lockAcquired();
      await lockReleased;
    });

    await acquired;

    const pending = Promise.all([
      patch({ dismissed: true }),
      patch({ name: 'Reserva' }),
    ]);

    await waitForLockedPatches();
    releaseLock();
    await holder;

    const [dismissal, rename] = await pending;
    const row = await currentGoal();

    expect(row).toMatchObject({
      name: 'Reserva',
      targetCents: TARGET_CENTS,
      monthlyAporteCents: APORTE_CENTS,
      currentCents: FUNDED_CENTS,
    });
    expect(row.dismissedAt?.getTime()).toBe(dismissal.now.getTime());
    expect(dismissal.goal.record.currentCents).toBe(FUNDED_CENTS);
    expect(rename.goal.record.currentCents).toBe(FUNDED_CENTS);
    expect(dismissal.goal.etaMonths).toBe(expectedEtaMonths(FUNDED_CENTS));
    expect(rename.goal.etaMonths).toBe(expectedEtaMonths(row.currentCents));
  });
});
