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
import { randomUUID } from 'node:crypto';

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
