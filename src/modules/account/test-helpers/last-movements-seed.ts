import { TransactionStatus, TransactionType } from '@constants/enums';
import * as schema from '@infra/databases/drizzle/schema';
import { AccountRepository } from '@modules/account/repositories/contracts/AccountRepository';
import { makeCheckingAccount } from '@modules/account/test-helpers/mock-factories';
import { Category } from '@modules/category/entities/Category';
import { CategoryRepository } from '@modules/category/repositories/contracts/CategoryRepository';
import { Workspace } from '@modules/workspace/entities/Workspace';
import { WorkspaceRepository } from '@modules/workspace/repositories/contracts/WorkspaceRepository';
import type { Abstract } from '@nestjs/common';
import type { TestDatabase } from '@shared/cache/test-helpers/freshness-harness';
import { randomUUID } from 'node:crypto';

type RepositoryHost = {
  get<T>(token: Abstract<T>): T;
};

export function unwrap<T>(result: { isLeft(): boolean; value: unknown }): T {
  if (result.isLeft()) throw result.value;
  return result.value as T;
}

export type LastMovementsSeed = {
  workspaceId: string;
  userId: string;
  accountId: string;
  destinationAccountId: string;
  pendingAccountId: string;
  categoryId: string;
};

type SeedContext = {
  app: RepositoryHost;
  db: TestDatabase;
};

export async function seedLastMovements(
  { app, db }: SeedContext,
  timezone: string,
): Promise<LastMovementsSeed> {
  const workspaceId = randomUUID();
  const userId = randomUUID();
  const accountId = randomUUID();
  const destinationAccountId = randomUUID();
  const pendingAccountId = randomUUID();
  const categoryId = randomUUID();

  await db.insert(schema.users).values({
    id: userId,
    email: `${userId}@example.com`,
    passwordHash: 'hash',
    name: 'Movements',
  });
  await app
    .get(WorkspaceRepository)
    .create(
      unwrap<Workspace>(
        Workspace.create({ name: 'Movements', timezone }, workspaceId),
      ),
    );
  for (const id of [accountId, destinationAccountId, pendingAccountId]) {
    await app
      .get(AccountRepository)
      .create(
        makeCheckingAccount({ id, workspaceId, name: `Conta ${id}`, timezone }),
      );
  }
  await app.get(CategoryRepository).create(
    unwrap<Category>(
      Category.create(
        {
          workspaceId,
          name: 'Mercado',
          type: TransactionType.EXPENSE,
          parentId: null,
          isSystemCategory: false,
        },
        categoryId,
      ),
    ),
  );

  return {
    workspaceId,
    userId,
    accountId,
    destinationAccountId,
    pendingAccountId,
    categoryId,
  };
}

export async function insertLastMovement(
  db: TestDatabase,
  seed: LastMovementsSeed,
  overrides: Partial<typeof schema.transactions.$inferInsert> = {},
): Promise<void> {
  await db.insert(schema.transactions).values({
    workspaceId: seed.workspaceId,
    accountId: seed.accountId,
    categoryId: seed.categoryId,
    title: 'Movimento',
    amount: 1_000,
    date: new Date('2026-11-10T15:00:00.000Z'),
    type: TransactionType.EXPENSE,
    status: TransactionStatus.COMPLETED,
    ...overrides,
  });
}
