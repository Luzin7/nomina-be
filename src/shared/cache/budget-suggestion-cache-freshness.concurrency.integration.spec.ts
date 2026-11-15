import { TransactionStatus, TransactionType } from '@constants/enums';
import { SALARY_CATEGORY_NAME } from '@constants/incomeCategories';
import * as schema from '@infra/databases/drizzle/schema';
import { AccountRepository } from '@modules/account/repositories/contracts/AccountRepository';
import { makeCheckingAccount } from '@modules/account/test-helpers/mock-factories';
import { AcceptIncomeSuggestionService } from '@modules/budget/features/accept-income-suggestion/accept-income-suggestion.handler';
import { AcceptSplitSuggestionService } from '@modules/budget/features/accept-split-suggestion/accept-split-suggestion.handler';
import {
  ResolveBudgetSuggestionService,
  type BudgetSuggestion,
} from '@modules/budget/services/resolve-budget-suggestion.service';
import { Category } from '@modules/category/entities/Category';
import { CategoryRepository } from '@modules/category/repositories/contracts/CategoryRepository';
import { CreateTransactionService } from '@modules/transaction/features/create-transaction/create-transaction.service';
import { Workspace } from '@modules/workspace/entities/Workspace';
import { WorkspaceRepository } from '@modules/workspace/repositories/contracts/WorkspaceRepository';
import { randomUUID } from 'node:crypto';
import {
  ApplicationHandle,
  createApplication,
  PostgresHandle,
  startPostgres,
  startValkey,
  ValkeyHandle,
} from './test-helpers/freshness-harness';
import { unwrap } from './test-helpers/freshness-suite';

jest.setTimeout(180_000);

const TIMEZONE = 'UTC';
const BASIS_MONTHS = [1, 2, 3];
const ACTIVE_DAYS = [1, 2, 3, 4, 5];
const INCOME_CENTS = 500_000n;
const EXPENSE_CENTS = 20_000n;

const monthOffsetDate = (monthsBack: number, day: number): string => {
  const now = new Date();
  const date = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - monthsBack, day),
  );
  return date.toISOString().slice(0, 10);
};

describe('budget suggestion cache freshness', () => {
  let postgres: PostgresHandle;
  let valkey: ValkeyHandle;
  let app: ApplicationHandle;
  let workspaceId: string;

  const resolveSuggestion = async (): Promise<BudgetSuggestion> =>
    unwrap<BudgetSuggestion>(
      await app.get(ResolveBudgetSuggestionService).execute({ workspaceId }),
    );

  const seedHistory = async (): Promise<void> => {
    const userId = randomUUID();
    const accountId = randomUUID();
    const categoryId = randomUUID();
    const incomeCategoryId = randomUUID();
    workspaceId = randomUUID();

    await postgres.db.insert(schema.users).values({
      id: userId,
      email: `${userId}@example.com`,
      passwordHash: 'hash',
      name: 'Suggestion',
    });
    await app
      .get(WorkspaceRepository)
      .create(
        unwrap<Workspace>(
          Workspace.create(
            { name: 'Suggestion', timezone: TIMEZONE },
            workspaceId,
          ),
        ),
      );
    await app.get(AccountRepository).create(
      makeCheckingAccount({
        id: accountId,
        workspaceId,
        name: 'Conta',
        balance: 0n,
        timezone: TIMEZONE,
      }),
    );
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
          categoryId,
        ),
      ),
    );

    await app.get(CategoryRepository).create(
      unwrap<Category>(
        Category.create(
          {
            workspaceId,
            name: SALARY_CATEGORY_NAME,
            type: TransactionType.INCOME,
            parentId: null,
            isSystemCategory: false,
          },
          incomeCategoryId,
        ),
      ),
    );

    const create = app.get(CreateTransactionService);
    for (const monthsBack of BASIS_MONTHS) {
      unwrap(
        await create.execute({
          workspaceId,
          sub: userId,
          accountId,
          categoryId: incomeCategoryId,
          title: 'Salario',
          amount: INCOME_CENTS,
          date: monthOffsetDate(monthsBack, 1),
          type: TransactionType.INCOME,
          status: TransactionStatus.COMPLETED,
        } as never),
      );
      for (const day of ACTIVE_DAYS) {
        unwrap(
          await create.execute({
            workspaceId,
            sub: userId,
            accountId,
            categoryId,
            title: 'Gasto',
            amount: EXPENSE_CENTS,
            date: monthOffsetDate(monthsBack, day),
            type: TransactionType.EXPENSE,
            status: TransactionStatus.COMPLETED,
          } as never),
        );
      }
    }
  };

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

  beforeEach(seedHistory);

  it('never serves a stale pending income after accept-income', async () => {
    const warm = await resolveSuggestion();
    if (warm.income.status !== 'pending') throw new Error('income not pending');

    unwrap(
      await app.get(AcceptIncomeSuggestionService).execute({
        workspaceId,
        fingerprint: warm.income.fingerprint,
      }),
    );

    expect((await resolveSuggestion()).income).toEqual({ status: 'accepted' });
  });

  it('never serves a stale pending split after accept-split', async () => {
    const income = (await resolveSuggestion()).income;
    if (income.status !== 'pending') throw new Error('income not pending');
    unwrap(
      await app.get(AcceptIncomeSuggestionService).execute({
        workspaceId,
        fingerprint: income.fingerprint,
      }),
    );
    const warm = await resolveSuggestion();
    if (warm.split.status !== 'pending') throw new Error('split not pending');
    expect((await resolveSuggestion()).split).toEqual(warm.split);

    unwrap(
      await app.get(AcceptSplitSuggestionService).execute({
        workspaceId,
        fingerprint: warm.split.fingerprint,
      }),
    );

    expect((await resolveSuggestion()).split.status).not.toBe('pending');
  });

  it('matches an uncached read after the cache is flushed', async () => {
    await resolveSuggestion();
    const served = JSON.stringify(await resolveSuggestion());
    await valkey.flush();

    expect(JSON.stringify(await resolveSuggestion())).toBe(served);
  });
});
