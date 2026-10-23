import { AccountType, BalanceMovementCause } from '@constants/enums';
import { DRIZZLE_TOKEN } from '@infra/databases/drizzle/drizzle.provider';
import { DrizzleService } from '@infra/databases/drizzle/drizzle.service';
import * as schema from '@infra/databases/drizzle/schema';
import { CheckingAccount } from '@modules/account/entities/CheckingAccount';
import { CreditCard } from '@modules/account/entities/CreditCardAccount';
import { AnyAccount } from '@modules/account/entities/types';
import { CreateAccountService } from '@modules/account/features/create-account/create-account.service';
import { Test, TestingModule } from '@nestjs/testing';
import {
  PostgreSqlContainer,
  StartedPostgreSqlContainer,
} from '@testcontainers/postgresql';
import { eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { resolve } from 'node:path';
import postgres from 'postgres';
import { AccountRepositoryImplementation } from './account.repository';

jest.mock('@sentry/nestjs', () => ({ captureException: jest.fn() }));

const MIGRATIONS_FOLDER = resolve(__dirname, '../../../../../drizzle');
const WORKSPACE_ID = 'ws-opening';
const ACTOR_ID = 'user-opening';
const TIMEZONE = 'America/Sao_Paulo';

jest.setTimeout(180_000);

function unwrap(result: { isLeft(): boolean; value: unknown }): AnyAccount {
  if (result.isLeft()) throw result.value;
  return result.value as AnyAccount;
}

describe('account creation opening movement', () => {
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
      email: 'opening@example.com',
      passwordHash: 'hash',
      name: 'Opening',
    });
    await db
      .insert(schema.workspaces)
      .values({ id: WORKSPACE_ID, name: 'Opening' });
  });

  function makeChecking(balance: bigint): AnyAccount {
    return unwrap(
      CheckingAccount.create({
        workspaceId: WORKSPACE_ID,
        name: 'Checking',
        type: AccountType.CHECKING,
        balance,
        timezone: TIMEZONE,
      }),
    );
  }

  function makeCard(): AnyAccount {
    return unwrap(
      CreditCard.create({
        workspaceId: WORKSPACE_ID,
        name: 'Card',
        creditLimit: 500000n,
        closingDaysBeforeDue: 5,
        dueDay: 15,
        timezone: TIMEZONE,
      }),
    );
  }

  async function openingMovementsOf(accountId: string) {
    return db
      .select()
      .from(schema.balanceMovements)
      .where(eq(schema.balanceMovements.accountId, accountId));
  }

  it.each([
    ['checking with balance 5000', () => makeChecking(5000n), 5000],
    ['checking with zero balance', () => makeChecking(0n), 0],
    ['credit card', makeCard, 0],
  ])(
    'should link the opening movement to the created account: %s',
    async (_label, build, balance) => {
      const account = build();

      await repository.createWithOpeningMovement(account, ACTOR_ID);

      expect(account.id).toEqual(expect.any(String));
      expect(account.id).not.toBe('');
      const [stored] = await db.select().from(schema.accounts);
      expect(stored.id).toBe(account.id);
      const movements = await openingMovementsOf(account.id);
      expect(movements).toHaveLength(1);
      expect(movements[0]).toMatchObject({
        cause: BalanceMovementCause.OPENING,
        workspaceId: WORKSPACE_ID,
        delta: balance,
        balanceAfter: balance,
        actorId: ACTOR_ID,
      });
    },
  );

  it('should return the created account with its id from the service', async () => {
    const userRepository = { findUniqueById: jest.fn().mockResolvedValue({}) };
    const cache = { delByPattern: jest.fn() };
    const service = new CreateAccountService(
      repository,
      userRepository as never,
      cache as never,
    );

    const result = await service.execute({
      sub: ACTOR_ID,
      workspaceId: WORKSPACE_ID,
      name: 'Via service',
      timezone: TIMEZONE,
      type: AccountType.CHECKING,
      balance: 5000,
    } as Parameters<typeof service.execute>[0]);

    if (result.isLeft()) throw result.value;
    const movements = await openingMovementsOf(result.value.id);
    expect(result.value.id).toEqual(expect.any(String));
    expect(movements).toHaveLength(1);
  });
});
