import {
  RecurrenceFrequency,
  RecurringSuggestionStatus,
  TransactionStatus,
  TransactionType,
} from '@constants/enums';
import * as schema from '@infra/databases/drizzle/schema';
import { AccountRepository } from '@modules/account/repositories/contracts/AccountRepository';
import {
  makeCheckingAccount,
  makeCreditCard,
} from '@modules/account/test-helpers/mock-factories';
import { SaveBudgetConfigService } from '@modules/budget/features/save-config/save-config.handler';
import { CreateGoalService } from '@modules/goal/features/create-goal/create-goal.service';
import { Category } from '@modules/category/entities/Category';
import { CategoryRepository } from '@modules/category/repositories/contracts/CategoryRepository';
import { CreateTransactionService } from '@modules/transaction/features/create-transaction/create-transaction.service';
import { Workspace } from '@modules/workspace/entities/Workspace';
import { WorkspaceRepository } from '@modules/workspace/repositories/contracts/WorkspaceRepository';
import { eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import {
  ApplicationHandle,
  createApplication,
  startPostgres,
  startValkey,
  PostgresHandle,
  TestDatabase,
  ValkeyHandle,
} from './freshness-harness';

export const WORKSPACE_TIMEZONE = 'UTC';
export const OPENING_BALANCE = 50_000n;
export const AMOUNT = 1_000n;
export const GOAL_TARGET_CENTS = 100_000;
export const DAY_MS = 86_400_000;

export interface FreshnessSeed {
  workspaceId: string;
  userId: string;
  accountId: string;
  otherAccountId: string;
  cardId: string;
  recurringId: string;
  suggestionId: string;
  categoryId: string;
  extraCategoryId: string;
  budgetCategoryId: string;
  goalId: string;
  transactionId: string;
  today: string;
  monthStart: string;
  month: number;
  year: number;
}

export interface FreshnessContext {
  app: ApplicationHandle;
  db: TestDatabase;
  seed: FreshnessSeed;
}

export type FreshnessDomain = 'ledger' | 'category' | 'goal';

export interface FreshnessRead {
  name: string;
  domains: FreshnessDomain[];
  run(context: FreshnessContext): Promise<unknown>;
}

export interface FreshnessWrite {
  name: string;
  prepare?(context: FreshnessContext): Promise<void>;
  run(context: FreshnessContext): Promise<void>;
  changes: string[];
}

export interface FreshnessSuite {
  title: string;
  domain: FreshnessDomain;
  reads: FreshnessRead[];
  writes: FreshnessWrite[];
}

const CREATED_TITLE = 'Seeded expense';
const INCOME_AMOUNT = 10_000n;
const BUDGET_INCOME_CENTS = 100_000;
const BREACHED_TARGET_CENTS = 500;
const REMAINING_TARGET_CENTS = 20_000;

export function unwrap<T>(result: { isLeft(): boolean; value: unknown }): T {
  if (result.isLeft()) throw result.value;
  return result.value as T;
}

export function snapshot(value: unknown): string {
  return JSON.stringify(value, (_key, entry) =>
    typeof entry === 'bigint' ? `${entry}n` : entry,
  );
}

async function seedWorkspace(
  app: ApplicationHandle,
  db: TestDatabase,
): Promise<FreshnessSeed> {
  const workspaceId = randomUUID();
  const userId = randomUUID();
  const accountId = randomUUID();
  const otherAccountId = randomUUID();
  const cardId = randomUUID();
  const recurringId = randomUUID();
  const suggestionId = randomUUID();
  const categoryId = randomUUID();
  const extraCategoryId = randomUUID();
  const budgetCategoryId = randomUUID();
  const now = new Date();
  const today = now.toISOString().slice(0, 10);

  await db.insert(schema.users).values({
    id: userId,
    email: `${userId}@example.com`,
    passwordHash: 'hash',
    name: 'Freshness',
  });
  const workspace = unwrap<Workspace>(
    Workspace.create(
      { name: 'Freshness', timezone: WORKSPACE_TIMEZONE },
      workspaceId,
    ),
  );
  await app.get(WorkspaceRepository).create(workspace);
  for (const id of [accountId, otherAccountId]) {
    await app.get(AccountRepository).create(
      makeCheckingAccount({
        id,
        workspaceId,
        name: `Conta ${id}`,
        balance: OPENING_BALANCE,
        timezone: WORKSPACE_TIMEZONE,
      }),
    );
  }
  await app.get(AccountRepository).create(
    makeCreditCard({
      id: cardId,
      workspaceId,
      name: 'Cartao',
      timezone: WORKSPACE_TIMEZONE,
    }),
  );
  const category = unwrap<Category>(
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
  );
  await app.get(CategoryRepository).create(category);
  const extraCategory = unwrap<Category>(
    Category.create(
      {
        workspaceId,
        name: 'Lazer',
        type: TransactionType.EXPENSE,
        parentId: null,
        isSystemCategory: false,
      },
      extraCategoryId,
    ),
  );
  await app.get(CategoryRepository).create(extraCategory);
  await app.get(CategoryRepository).create(
    unwrap<Category>(
      Category.create(
        {
          workspaceId,
          name: 'Moradia',
          type: TransactionType.EXPENSE,
          parentId: null,
          isSystemCategory: false,
        },
        budgetCategoryId,
      ),
    ),
  );
  const goal = unwrap<{ goal: { record: { id: string } } }>(
    await app.get(CreateGoalService).execute({
      workspaceId,
      name: 'Viagem',
      targetCents: GOAL_TARGET_CENTS,
    }),
  );
  unwrap(
    await app.get(CreateGoalService).execute({
      workspaceId,
      name: 'Reserva',
      targetCents: GOAL_TARGET_CENTS,
      linkedAccountId: otherAccountId,
      categoryId: extraCategoryId,
    }),
  );
  unwrap(
    await app.get(CreateTransactionService).execute({
      workspaceId,
      sub: userId,
      accountId,
      categoryId,
      title: CREATED_TITLE,
      amount: AMOUNT,
      date: today,
      type: TransactionType.EXPENSE,
      status: TransactionStatus.COMPLETED,
    } as never),
  );
  unwrap(
    await app.get(CreateTransactionService).execute({
      workspaceId,
      sub: userId,
      accountId,
      title: 'Seeded income',
      amount: INCOME_AMOUNT,
      date: today,
      type: TransactionType.INCOME,
      status: TransactionStatus.COMPLETED,
    } as never),
  );
  unwrap(
    await app.get(SaveBudgetConfigService).execute({
      workspaceId,
      mode: 'fixed',
      monthlyIncome: BUDGET_INCOME_CENTS,
      effectiveFrom: `${today.slice(0, 8)}01`,
      allocations: [
        { categoryId, targetCents: BREACHED_TARGET_CENTS },
        {
          categoryId: budgetCategoryId,
          targetCents: REMAINING_TARGET_CENTS,
        },
      ],
    }),
  );
  await db.insert(schema.recurringTransactions).values({
    id: recurringId,
    workspaceId,
    accountId,
    categoryId,
    type: TransactionType.INCOME,
    title: 'Assinatura',
    amount: Number(AMOUNT),
    frequency: RecurrenceFrequency.MONTHLY,
    interval: 1,
    startDate: new Date(now.getTime() + 60 * DAY_MS),
    active: true,
  });
  await db.insert(schema.recurringSuggestions).values({
    id: suggestionId,
    workspaceId,
    categoryId,
    accountId,
    suggestedTitle: 'Internet',
    amount: Number(AMOUNT),
    dayOfMonth: 10,
    status: RecurringSuggestionStatus.PENDING,
  });
  const [created] = await db
    .select({ id: schema.transactions.id })
    .from(schema.transactions)
    .where(eq(schema.transactions.workspaceId, workspaceId));

  return {
    workspaceId,
    userId,
    accountId,
    otherAccountId,
    cardId,
    recurringId,
    suggestionId,
    categoryId,
    extraCategoryId,
    budgetCategoryId,
    goalId: goal.goal.record.id,
    transactionId: created.id,
    today,
    monthStart: `${today.slice(0, 8)}01`,
    month: Number(today.slice(5, 7)),
    year: Number(today.slice(0, 4)),
  };
}

export function defineFreshnessSuite({
  title,
  domain,
  reads: allReads,
  writes,
}: FreshnessSuite): void {
  jest.setTimeout(180_000);

  describe(title, () => {
    let postgres: PostgresHandle;
    let valkey: ValkeyHandle;
    let app: ApplicationHandle;

    beforeAll(async () => {
      postgres = await startPostgres();
      valkey = await startValkey();
      app = await createApplication(postgres.db, valkey.cache);
    });

    afterAll(async () => {
      await app?.close();
      await valkey?.stop();
      await postgres?.stop();
    });

    const reads = allReads.filter((read) => read.domains.includes(domain));
    const cases = writes.flatMap((write) =>
      reads.map((read) => ({ write, read })),
    );

    it.each(cases.map(({ write, read }) => [write.name, read.name]))(
      '%s keeps %s fresh',
      async (writeName, readName) => {
        const write = writes.find(({ name }) => name === writeName);
        const read = reads.find(({ name }) => name === readName);
        if (!write || !read) throw new Error('unknown freshness case');
        const context = {
          app,
          db: postgres.db,
          seed: await seedWorkspace(app, postgres.db),
        };

        await write.prepare?.(context);
        const warm = snapshot(await read.run(context));
        await write.run(context);
        const served = snapshot(await read.run(context));
        await valkey.flush();
        const fresh = snapshot(await read.run(context));

        expect(served).toBe(fresh);
        if (write.changes.includes(readName)) expect(warm).not.toBe(fresh);
      },
    );
  });
}
