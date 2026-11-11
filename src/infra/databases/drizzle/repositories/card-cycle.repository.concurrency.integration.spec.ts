import { AccountType, TransactionType } from '@constants/enums';
import { DrizzleService } from '@infra/databases/drizzle/drizzle.service';
import * as schema from '@infra/databases/drizzle/schema';
import { CardCycleBudgetExistsError } from '@modules/card-cycle/errors';
import {
  CardCyclePeriodRecord,
  MaterializeCardCyclePeriodInput,
} from '@modules/card-cycle/repositories/contracts/CardCycleRepository';
import { CardCycleWindow } from '@modules/card-cycle/valueObjects/CardCycleWindow';
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
import { CardCycleRepositoryImplementation } from './card-cycle.repository';

type Database = ReturnType<typeof drizzle<typeof schema>>;

const MIGRATIONS_FOLDER = resolve(__dirname, '../../../../../drizzle');
const CARD_TIMEZONE = 'America/Sao_Paulo';
const LOCK_WAIT_MS = 2_000;

jest.setTimeout(180_000);

function createDeferred(): { promise: Promise<void>; resolve: () => void } {
  let resolveDeferred: () => void = () => undefined;
  const promise = new Promise<void>((resolve) => {
    resolveDeferred = resolve;
  });

  return { promise, resolve: resolveDeferred };
}

describe('CardCycleRepositoryImplementation against a real postgres', () => {
  let container: StartedPostgreSqlContainer;
  let queryClient: postgres.Sql;
  let db: Database;
  let repository: CardCycleRepositoryImplementation;
  let workspaceId: string;
  let accountId: string;
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

    repository = new CardCycleRepositoryImplementation({
      db,
    } as unknown as DrizzleService);
  });

  afterAll(async () => {
    await queryClient.end({ timeout: 5 });
    await container.stop();
  });

  beforeEach(async () => {
    await db.execute(
      sql`TRUNCATE workspaces, accounts, categories, transactions, card_cycle_periods, card_cycle_budgets RESTART IDENTITY CASCADE`,
    );

    workspaceId = randomUUID();
    accountId = randomUUID();
    categoryId = randomUUID();

    await db.insert(schema.workspaces).values({
      id: workspaceId,
      name: 'Workspace',
    });
    await db.insert(schema.accounts).values({
      id: accountId,
      workspaceId,
      name: 'Cartão',
      type: AccountType.CREDIT_CARD,
      timezone: CARD_TIMEZONE,
      dueDay: 28,
      closingDaysBeforeDue: 7,
    });
    await db.insert(schema.categories).values({
      id: categoryId,
      workspaceId,
      name: 'Mercado',
      type: TransactionType.EXPENSE,
    });
  });

  function materializeInput(
    window: CardCycleWindow,
  ): MaterializeCardCyclePeriodInput {
    return {
      workspaceId,
      accountId,
      window: window.toRecord(),
    };
  }

  async function periodCount(): Promise<number> {
    const [row] = await db
      .select({ count: sql<number>`COUNT(*)`.mapWith(Number) })
      .from(schema.cardCyclePeriods);

    return row.count;
  }

  async function insertTransaction(
    amount: number,
    date: Date,
    type: TransactionType,
    status: string,
  ): Promise<void> {
    await db.insert(schema.transactions).values({
      workspaceId,
      accountId,
      categoryId,
      title: 'Compra',
      amount,
      date,
      type,
      status,
    });
  }

  describe('materialization', () => {
    it('keeps one row and the same bounds on a replay', async () => {
      const input = materializeInput(
        CardCycleWindow.create({
          dueDate: '2027-01-28',
          dueDay: 28,
          closingDaysBeforeDue: 7,
        }),
      );

      const first = await repository.materializePeriod(input);
      const replay = await repository.materializePeriod(input);

      expect(replay.id).toBe(first.id);
      expect(replay.periodStart).toBe('2026-12-22');
      expect(replay.periodEnd).toBe('2027-01-21');
      expect(await periodCount()).toBe(1);
    });

    it('leaves exactly one row when two materializations race', async () => {
      const window = CardCycleWindow.create({
        dueDate: '2027-01-28',
        dueDay: 28,
        closingDaysBeforeDue: 7,
      }).toRecord();

      const results = await Promise.all([
        repository.materializePeriod({
          workspaceId,
          accountId,
          window,
        }),
        repository.materializePeriod({
          workspaceId,
          accountId,
          window,
        }),
      ]);

      const ids = results.map((record: CardCyclePeriodRecord) => record.id);
      expect(new Set(ids).size).toBe(1);
      expect(results[0].periodStart).toBe('2026-12-22');
      expect(results[1].periodEnd).toBe('2027-01-21');
      expect(await periodCount()).toBe(1);
    });

    it('keeps stored bounds after the card due day changes', async () => {
      const materialized = await repository.materializePeriod(
        materializeInput(
          CardCycleWindow.create({
            dueDate: '2027-01-28',
            dueDay: 28,
            closingDaysBeforeDue: 7,
          }),
        ),
      );

      await db
        .update(schema.accounts)
        .set({ dueDay: 10 })
        .where(eq(schema.accounts.id, accountId));

      const reread = await repository.findPeriod(
        workspaceId,
        accountId,
        '2027-01-28',
      );

      expect(reread).toEqual(materialized);
      expect(reread?.periodStart).toBe('2026-12-22');
      expect(reread?.periodEnd).toBe('2027-01-21');
      expect(reread?.dueDay).toBe(28);

      const next = await repository.materializePeriod(
        materializeInput(
          CardCycleWindow.create({
            dueDate: '2027-01-10',
            dueDay: 10,
            closingDaysBeforeDue: 7,
          }),
        ),
      );

      expect(next.dueDate).toBe('2027-01-10');
      expect(next.dueDay).toBe(10);
      expect(next.periodStart).toBe('2026-12-04');
      expect(next.periodEnd).toBe('2027-01-03');
      expect(await periodCount()).toBe(2);
    });
  });

  describe('limit', () => {
    it('refuses a second limit for the same effective date', async () => {
      const first = await repository.saveBudget({
        workspaceId,
        accountId,
        effectiveFrom: '2027-01-28',
        limitCents: 250_000,
      });

      await expect(
        repository.saveBudget({
          workspaceId,
          accountId,
          effectiveFrom: '2027-01-28',
          limitCents: 900_000,
        }),
      ).rejects.toBeInstanceOf(CardCycleBudgetExistsError);

      const [stored] = await db
        .select()
        .from(schema.cardCycleBudgets)
        .where(eq(schema.cardCycleBudgets.id, first.id));

      expect(stored.limitCents).toBe(250_000);
    });

    it('creates one limit when two creates race', async () => {
      const save = () =>
        repository.saveBudget({
          workspaceId,
          accountId,
          effectiveFrom: '2027-01-28',
          limitCents: 250_000,
        });

      const results = await Promise.allSettled([save(), save()]);
      const rejected = results.filter(
        (result): result is PromiseRejectedResult =>
          result.status === 'rejected',
      );

      expect(
        results.filter((result) => result.status === 'fulfilled'),
      ).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect(rejected[0].reason).toBeInstanceOf(CardCycleBudgetExistsError);
    });

    it('saves a limit for another account while the workspace lock is held', async () => {
      const otherAccountId = randomUUID();
      await db.insert(schema.accounts).values({
        id: otherAccountId,
        workspaceId,
        name: 'Outro cartão',
        type: AccountType.CREDIT_CARD,
        timezone: CARD_TIMEZONE,
        dueDay: 10,
        closingDaysBeforeDue: 3,
      });

      const holder = postgres(container.getConnectionUri(), { max: 1 });
      const lockTaken = createDeferred();
      const releaseLock = createDeferred();

      const holding = holder.begin(async (tx) => {
        await tx`SELECT pg_advisory_xact_lock(hashtext(${workspaceId}))`;
        lockTaken.resolve();
        await releaseLock.promise;
      });

      let deadline: NodeJS.Timeout | undefined;

      try {
        await lockTaken.promise;

        const saving = repository
          .saveBudget({
            workspaceId,
            accountId: otherAccountId,
            effectiveFrom: '2027-01-28',
            limitCents: 1_000,
          })
          .then(() => 'saved' as const);
        const blocked = new Promise<'blocked'>((resolve) => {
          deadline = setTimeout(() => resolve('blocked'), LOCK_WAIT_MS);
        });

        expect(await Promise.race([saving, blocked])).toBe('saved');
      } finally {
        clearTimeout(deadline);
        releaseLock.resolve();
        await holding;
        await holder.end({ timeout: 5 });
      }
    });
  });

  describe('cycle spend', () => {
    const window = {
      periodStart: '2026-11-22',
      periodEnd: '2026-12-21',
    };

    async function spend(): Promise<number> {
      return repository.sumCycleSpend({
        workspaceId,
        accountId,
        timezone: CARD_TIMEZONE,
        ...window,
      });
    }

    it('counts only completed expenses inside the window in the card timezone', async () => {
      await insertTransaction(
        10_000,
        new Date('2026-12-01T15:00:00.000Z'),
        TransactionType.EXPENSE,
        'COMPLETED',
      );
      await insertTransaction(
        20_000,
        new Date('2026-12-22T02:50:00.000Z'),
        TransactionType.EXPENSE,
        'COMPLETED',
      );
      await insertTransaction(
        30_000,
        new Date('2026-12-22T03:00:00.000Z'),
        TransactionType.EXPENSE,
        'COMPLETED',
      );
      await insertTransaction(
        40_000,
        new Date('2026-12-10T15:00:00.000Z'),
        TransactionType.EXPENSE,
        'PENDING',
      );
      await insertTransaction(
        50_000,
        new Date('2026-12-10T15:00:00.000Z'),
        TransactionType.TRANSFER,
        'COMPLETED',
      );

      expect(await spend()).toBe(30_000);
    });

    it('returns zero when nothing was spent in the window', async () => {
      await insertTransaction(
        10_000,
        new Date('2027-02-01T15:00:00.000Z'),
        TransactionType.EXPENSE,
        'COMPLETED',
      );

      expect(await spend()).toBe(0);
    });
  });
});
