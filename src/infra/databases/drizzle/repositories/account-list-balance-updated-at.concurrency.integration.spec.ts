import { AccountType, BalanceMovementCause } from '@constants/enums';
import { DRIZZLE_TOKEN } from '@infra/databases/drizzle/drizzle.provider';
import { DrizzleService } from '@infra/databases/drizzle/drizzle.service';
import * as schema from '@infra/databases/drizzle/schema';
import { CheckingAccount } from '@modules/account/entities/CheckingAccount';
import { Test, TestingModule } from '@nestjs/testing';
import {
  PostgreSqlContainer,
  StartedPostgreSqlContainer,
} from '@testcontainers/postgresql';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { resolve } from 'node:path';
import postgres from 'postgres';
import { AccountRepositoryImplementation } from './account.repository';

jest.mock('@sentry/nestjs', () => ({ captureException: jest.fn() }));

const MIGRATIONS_FOLDER = resolve(__dirname, '../../../../../drizzle');
const WORKSPACE_ID = 'ws-balance-updated';
const ACTOR_ID = 'user-balance-updated';

jest.setTimeout(180_000);

describe('list accounts balanceUpdatedAt', () => {
  let container: StartedPostgreSqlContainer;
  let queryClient: postgres.Sql;
  let moduleRef: TestingModule;
  let db: DrizzleService['db'];
  let repository: AccountRepositoryImplementation;

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
        AccountRepositoryImplementation,
      ],
    }).compile();

    db = moduleRef.get(DrizzleService).db;
    repository = moduleRef.get(AccountRepositoryImplementation);
  });

  afterAll(async () => {
    await moduleRef.close();
    await queryClient.end({ timeout: 5 });
    await container.stop();
  });

  beforeEach(async () => {
    await db.execute(
      sql`TRUNCATE users, accounts, balance_movements, workspaces CASCADE`,
    );
    await db.insert(schema.users).values({
      id: ACTOR_ID,
      email: 'balance-updated@example.com',
      passwordHash: 'hash',
      name: 'Balance Updated',
    });
    await db
      .insert(schema.workspaces)
      .values({ id: WORKSPACE_ID, name: 'Balance Updated' });
  });

  async function createChecking(name: string) {
    const result = CheckingAccount.create({
      workspaceId: WORKSPACE_ID,
      name,
      type: AccountType.CHECKING,
      balance: 1000n,
      timezone: 'America/Sao_Paulo',
    });
    if (result.isLeft()) throw result.value;
    await repository.createWithOpeningMovement(result.value, ACTOR_ID);
    return result.value;
  }

  async function addMovement(accountId: string, createdAt: Date) {
    await db.insert(schema.balanceMovements).values({
      workspaceId: WORKSPACE_ID,
      accountId,
      transactionId: null,
      cause: BalanceMovementCause.RECONCILIATION,
      delta: 1,
      balanceAfter: 1,
      actorId: ACTOR_ID,
      createdAt,
    });
  }

  it('should return created_at of the movement with the highest seq, not the latest created_at', async () => {
    const account = await createChecking('Checking');
    await db
      .update(schema.balanceMovements)
      .set({ createdAt: new Date('2026-01-01T00:00:00.000Z') });
    await addMovement(account.id, new Date('2026-03-01T00:00:00.000Z'));
    await addMovement(account.id, new Date('2026-02-01T00:00:00.000Z'));

    const { accounts } = await repository.findManyByWorkspaceId(
      WORKSPACE_ID,
      1,
      10,
    );

    expect(accounts).toHaveLength(1);
    expect(accounts[0].balanceUpdatedAt).toEqual(
      new Date('2026-02-01T00:00:00.000Z'),
    );
  });

  it('should return the opening movement created_at for an account without other movements', async () => {
    await createChecking('Checking');
    const [opening] = await db.select().from(schema.balanceMovements);

    const { accounts, total } = await repository.findManyByWorkspaceId(
      WORKSPACE_ID,
      1,
      10,
    );

    expect(total).toBe(1);
    expect(accounts[0].balanceUpdatedAt).toEqual(opening.createdAt);
  });
});
