import * as schema from '@infra/databases/drizzle/schema';
import { AccountRepository } from '@modules/account/repositories/contracts/AccountRepository';
import { makeCheckingAccount } from '@modules/account/test-helpers/mock-factories';
import { InMemoryCacheProvider } from '@shared/cache/test-helpers/in-memory-cache';
import {
  ApplicationHandle,
  createApplication,
  startPostgres,
  PostgresHandle,
  TestDatabase,
} from '@shared/cache/test-helpers/freshness-harness';
import { getErrorDetails } from '@shared/utils/error-details';
import { eq, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';

const LOCK_POLL_ATTEMPTS = 200;
const LOCK_POLL_INTERVAL_MS = 20;

export const OPENING_BALANCE = 50_000n;
export const TARGET_CENTS = 600_000;

export interface ContributionHarness {
  app: ApplicationHandle;
  db: TestDatabase;
  stop(): Promise<void>;
}

export interface SeededGoal {
  workspaceId: string;
  goalId: string;
  accountId: string;
}

export async function startContributionHarness(): Promise<ContributionHarness> {
  const postgres: PostgresHandle = await startPostgres();
  const app = await createApplication(postgres.db, new InMemoryCacheProvider());

  return {
    app,
    db: postgres.db,
    stop: async () => {
      await app.close();
      await postgres.stop();
    },
  };
}

export async function seedGoal(
  { app, db }: Pick<ContributionHarness, 'app' | 'db'>,
  currentCents = 0,
): Promise<SeededGoal> {
  const workspaceId = randomUUID();
  const goalId = randomUUID();
  const accountId = randomUUID();

  await db.insert(schema.workspaces).values({ id: workspaceId, name: 'Casa' });
  await db.insert(schema.goals).values({
    id: goalId,
    workspaceId,
    name: 'Viagem',
    targetCents: TARGET_CENTS,
    currentCents,
  });
  await app.get(AccountRepository).create(
    makeCheckingAccount({
      id: accountId,
      workspaceId,
      name: 'Conta',
      balance: OPENING_BALANCE,
      timezone: 'UTC',
    }),
  );

  return { workspaceId, goalId, accountId };
}

export async function holdGoalLock(
  db: TestDatabase,
  goalId: string,
): Promise<() => Promise<void>> {
  let release: () => void = () => undefined;
  let acquired: () => void = () => undefined;
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  const locked = new Promise<void>((resolve) => {
    acquired = resolve;
  });
  const holder = db.transaction(async (tx) => {
    await tx
      .select()
      .from(schema.goals)
      .where(eq(schema.goals.id, goalId))
      .for('update');
    acquired();
    await released;
  });

  await locked;

  return async () => {
    release();
    await holder;
  };
}

export async function sqlStateOf(
  pending: Promise<unknown>,
): Promise<string | null> {
  try {
    await pending;
  } catch (error) {
    return getErrorDetails(error).sqlState;
  }

  return null;
}

export type Settled<T> =
  | { ok: true; value: T }
  | { ok: false; sqlState: string | null };

function settle<T>(pending: Promise<T>): Promise<Settled<T>> {
  return pending.then(
    (value) => ({ ok: true as const, value }),
    (error) => ({
      ok: false as const,
      sqlState: getErrorDetails(error).sqlState,
    }),
  );
}

export async function linkGoalToAccount(
  db: TestDatabase,
  goalId: string,
  accountId: string,
): Promise<void> {
  await db
    .update(schema.goals)
    .set({ linkedAccountId: accountId })
    .where(eq(schema.goals.id, goalId));
}

async function waitForLockWaiters(
  db: TestDatabase,
  expected: number,
): Promise<void> {
  for (let attempt = 0; attempt < LOCK_POLL_ATTEMPTS; attempt += 1) {
    const rows = (await db.execute(
      sql`SELECT count(*)::int AS waiting FROM pg_stat_activity WHERE wait_event_type = 'Lock'`,
    )) as unknown as { waiting: number }[];
    if (rows[0].waiting >= expected) return;

    await new Promise((resolve) => setTimeout(resolve, LOCK_POLL_INTERVAL_MS));
  }

  throw new Error('the transactions never waited on the held locks');
}

export async function raceAccountDelete<T>(
  db: TestDatabase,
  { goalId, accountId }: Pick<SeededGoal, 'goalId' | 'accountId'>,
  act: () => Promise<T>,
  deleteBlocks = true,
): Promise<{ acted: Settled<T>; deleted: Settled<unknown> }> {
  const release = await holdGoalLock(db, goalId);
  const acting = settle(act());
  await waitForLockWaiters(db, 1);
  const deleting = settle(
    db.delete(schema.accounts).where(eq(schema.accounts.id, accountId)),
  );
  if (deleteBlocks) await waitForLockWaiters(db, 2);
  if (!deleteBlocks) await deleting;
  await release();

  return { acted: await acting, deleted: await deleting };
}
