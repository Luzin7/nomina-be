import {
  BalanceMovementCause,
  TransactionStatus,
  TransactionType,
} from '@constants/enums';
import { DRIZZLE_TOKEN } from '@infra/databases/drizzle/drizzle.provider';
import { DrizzleService } from '@infra/databases/drizzle/drizzle.service';
import * as schema from '@infra/databases/drizzle/schema';
import { captureException } from '@sentry/nestjs';
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
import { ReconcileBalancesJobService } from './reconcile-balances.service';

jest.mock('@sentry/nestjs', () => ({ captureException: jest.fn() }));

const mockCaptureException = captureException as jest.MockedFunction<
  typeof captureException
>;

const AMOUNT = 1_000;
const ESCAPED_WRITE = 250;
const MIGRATIONS_FOLDER = resolve(__dirname, '../../../../../drizzle');
const TRANSACTION_DATE = new Date('2024-01-20T00:00:00.000Z');

jest.setTimeout(180_000);

describe('balance reconciliation against a seeded account', () => {
  let container: StartedPostgreSqlContainer;
  let queryClient: postgres.Sql;
  let moduleRef: TestingModule;
  let db: DrizzleService['db'];
  let service: ReconcileBalancesJobService;

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:16-alpine')
      .withStartupTimeout(120_000)
      .start();

    queryClient = postgres(container.getConnectionUri(), {
      max: 10,
      onnotice: () => undefined,
    });
    const drizzleDb = drizzle(queryClient, { schema });
    await migrate(drizzleDb, { migrationsFolder: MIGRATIONS_FOLDER });

    moduleRef = await Test.createTestingModule({
      providers: [
        DrizzleService,
        { provide: DRIZZLE_TOKEN, useValue: drizzleDb },
        ReconcileBalancesJobService,
      ],
    }).compile();

    db = moduleRef.get(DrizzleService).db;
    service = moduleRef.get(ReconcileBalancesJobService);
  });

  afterAll(async () => {
    await moduleRef?.close();
    await queryClient?.end({ timeout: 5 });
    await container?.stop();
  });

  afterEach(() => jest.clearAllMocks());

  beforeEach(async () => {
    await db.execute(
      sql`TRUNCATE accounts, transactions, balance_movements, workspaces, categories RESTART IDENTITY CASCADE`,
    );
  });

  async function seedAccountWithExpense(): Promise<{
    workspaceId: string;
    accountId: string;
  }> {
    const workspaceId = randomUUID();
    const accountId = randomUUID();
    const categoryId = randomUUID();

    await db.insert(schema.workspaces).values({
      id: workspaceId,
      name: 'Reconciliation',
      timezone: 'UTC',
    });
    await db.insert(schema.accounts).values({
      id: accountId,
      workspaceId,
      name: 'Checking',
      type: 'CHECKING',
      balance: 0,
      timezone: 'UTC',
    });
    await db.insert(schema.categories).values({
      id: categoryId,
      workspaceId,
      name: `Groceries ${categoryId}`,
      type: TransactionType.EXPENSE,
    });
    await db.insert(schema.transactions).values({
      id: randomUUID(),
      workspaceId,
      accountId,
      categoryId,
      title: `Expense ${randomUUID()}`,
      amount: AMOUNT,
      date: TRANSACTION_DATE,
      type: TransactionType.EXPENSE,
      status: TransactionStatus.COMPLETED,
    });
    await db.insert(schema.balanceMovements).values({
      workspaceId,
      accountId,
      cause: BalanceMovementCause.TRANSACTION_CREATED,
      delta: -AMOUNT,
      balanceAfter: -AMOUNT,
    });
    await db
      .update(schema.accounts)
      .set({ balance: -AMOUNT })
      .where(eq(schema.accounts.id, accountId));

    return { workspaceId, accountId };
  }

  async function applyBackfill(
    workspaceId: string,
    accountId: string,
  ): Promise<void> {
    const [snapshot] = await db.execute<{
      balance: string;
      movements: string;
    }>(sql`
      SELECT a.balance::bigint AS balance,
             (
               SELECT COALESCE(SUM(delta), 0)::bigint
               FROM balance_movements
               WHERE account_id = a.id
             ) AS movements
      FROM accounts a
      WHERE a.id = ${accountId}
    `);

    const balance = BigInt(snapshot.balance);
    const opening = balance - BigInt(snapshot.movements);

    await db.insert(schema.balanceMovements).values({
      workspaceId,
      accountId,
      cause: BalanceMovementCause.OPENING,
      delta: Number(opening),
      balanceAfter: Number(balance),
      actorId: 'system:backfill',
    });
  }

  it('reports no divergence once the opening row anchors the account', async () => {
    const { workspaceId, accountId } = await seedAccountWithExpense();
    await applyBackfill(workspaceId, accountId);

    const result = await service.execute();

    expect(result).toEqual({
      accountsChecked: 1,
      uncovered: 0,
      divergences: [],
    });
    expect(mockCaptureException).not.toHaveBeenCalled();
  });

  it('reports a balance write that escaped the movement ledger', async () => {
    const { workspaceId, accountId } = await seedAccountWithExpense();
    await applyBackfill(workspaceId, accountId);

    await db.execute(
      sql`UPDATE accounts SET balance = balance + ${ESCAPED_WRITE} WHERE id = ${accountId}`,
    );

    const result = await service.execute();

    expect(result.divergences).toEqual([
      {
        accountId,
        accountName: 'Checking',
        workspaceId,
        balance: -AMOUNT + ESCAPED_WRITE,
        movements: -AMOUNT,
        unexplained: ESCAPED_WRITE,
      },
    ]);
    expect(result.uncovered).toBe(0);
    expect(mockCaptureException).toHaveBeenCalledTimes(1);
  });

  it('reports an account without an opening row as uncovered', async () => {
    await seedAccountWithExpense();

    const result = await service.execute();

    expect(result.accountsChecked).toBe(1);
    expect(result.uncovered).toBe(1);
    expect(result.divergences).toEqual([]);
    expect(mockCaptureException).toHaveBeenCalledTimes(1);
  });
});
