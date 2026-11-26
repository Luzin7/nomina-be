import { TransactionStatus, TransactionType } from '@constants/enums';
import * as schema from '@infra/databases/drizzle/schema';
import { ListLastMovementsService } from '@modules/account/features/list-last-movements/list-last-movements.handler';
import { AccountRepository } from '@modules/account/repositories/contracts/AccountRepository';
import { makeCheckingAccount } from '@modules/account/test-helpers/mock-factories';
import { Category } from '@modules/category/entities/Category';
import { CategoryRepository } from '@modules/category/repositories/contracts/CategoryRepository';
import { Workspace } from '@modules/workspace/entities/Workspace';
import { WorkspaceRepository } from '@modules/workspace/repositories/contracts/WorkspaceRepository';
import {
  ApplicationHandle,
  createApplication,
  PostgresHandle,
  startPostgres,
} from '@shared/cache/test-helpers/freshness-harness';
import { InMemoryCacheProvider } from '@shared/cache/test-helpers/in-memory-cache';
import { randomUUID } from 'node:crypto';

jest.setTimeout(180_000);

function unwrap<T>(result: { isLeft(): boolean; value: unknown }): T {
  if (result.isLeft()) throw result.value;
  return result.value as T;
}

type Seed = Awaited<ReturnType<typeof seedWorkspace>>;

let postgres: PostgresHandle;
let app: ApplicationHandle;

async function seedWorkspace(timezone: string) {
  const workspaceId = randomUUID();
  const userId = randomUUID();
  const accountId = randomUUID();
  const destinationAccountId = randomUUID();
  const pendingAccountId = randomUUID();
  const categoryId = randomUUID();
  await postgres.db.insert(schema.users).values({
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

async function insertTransaction(
  seed: Seed,
  overrides: Partial<typeof schema.transactions.$inferInsert>,
) {
  await postgres.db.insert(schema.transactions).values({
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

const readMovements = async (seed: Seed) => {
  const { movements } = unwrap<{
    movements: { accountId: string; transactionId: string; title: string }[];
  }>(
    await app
      .get(ListLastMovementsService)
      .execute({ workspaceId: seed.workspaceId }),
  );

  return movements;
};

describe('last movements against a real database', () => {
  beforeAll(async () => {
    postgres = await startPostgres();
    app = await createApplication(postgres.db, new InMemoryCacheProvider());
  });

  afterAll(async () => {
    await app?.close();
    await postgres?.stop();
  });

  it('isolates each workspace and skips accounts with only pending rows', async () => {
    const first = await seedWorkspace('UTC');
    const second = await seedWorkspace('America/Sao_Paulo');
    await insertTransaction(first, {
      title: 'Antigo',
      date: new Date('2026-11-05T15:00:00.000Z'),
    });
    await insertTransaction(first, {
      title: 'Mercado',
      date: new Date('2026-11-20T15:00:00.000Z'),
    });
    await insertTransaction(first, {
      title: 'Transferência',
      type: TransactionType.TRANSFER,
      destinationAccountId: first.destinationAccountId,
      date: new Date('2026-11-22T15:00:00.000Z'),
    });
    await insertTransaction(first, {
      accountId: first.pendingAccountId,
      title: 'Pendente',
      status: TransactionStatus.PENDING,
      date: new Date('2026-11-23T15:00:00.000Z'),
    });
    await insertTransaction(second, {
      title: 'Aluguel',
      date: new Date('2026-11-18T15:00:00.000Z'),
    });
    await insertTransaction(second, {
      accountId: second.pendingAccountId,
      title: 'Pendente',
      status: TransactionStatus.PENDING,
      date: new Date('2026-11-24T15:00:00.000Z'),
    });

    const firstMovements = await readMovements(first);
    const secondMovements = await readMovements(second);

    expect(firstMovements).toHaveLength(2);
    expect(firstMovements).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          accountId: first.accountId,
          title: 'Transferência',
        }),
        expect.objectContaining({
          accountId: first.destinationAccountId,
          title: 'Transferência',
        }),
      ]),
    );
    expect(firstMovements.map(({ accountId }) => accountId)).not.toContain(
      first.pendingAccountId,
    );
    expect(secondMovements).toEqual([
      expect.objectContaining({
        accountId: second.accountId,
        title: 'Aluguel',
      }),
    ]);
    expect(secondMovements.map(({ accountId }) => accountId)).not.toContain(
      second.pendingAccountId,
    );
  });
});
