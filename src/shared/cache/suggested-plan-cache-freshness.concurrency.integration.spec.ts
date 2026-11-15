import { TransactionStatus, TransactionType } from '@constants/enums';
import { SALARY_CATEGORY_NAME } from '@constants/incomeCategories';
import * as schema from '@infra/databases/drizzle/schema';
import { AccountRepository } from '@modules/account/repositories/contracts/AccountRepository';
import { makeCheckingAccount } from '@modules/account/test-helpers/mock-factories';
import { RejectBudgetSuggestionService } from '@modules/budget/features/reject-budget-suggestion/reject-budget-suggestion.handler';
import { AcceptIncomeSuggestionService } from '@modules/budget/features/accept-income-suggestion/accept-income-suggestion.handler';
import { AcceptSplitSuggestionService } from '@modules/budget/features/accept-split-suggestion/accept-split-suggestion.handler';
import { ResolveBudgetSuggestionService } from '@modules/budget/services/resolve-budget-suggestion.service';
import { Category } from '@modules/category/entities/Category';
import { UpdateCategoryService } from '@modules/category/features/update-category/update-category.handler';
import { GetAvailableToSpendService } from '@modules/dashboard/features/get-available-to-spend/get-available-to-spend.handler';
import { GetMonthPaceService } from '@modules/report/features/get-month-pace/get-month-pace.handler';
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

describe('suggested plan cache freshness', () => {
  let postgres: PostgresHandle;
  let valkey: ValkeyHandle;
  let app: ApplicationHandle;
  let workspaceId: string;
  let userId: string;
  let categoryId: string;

  const readHero = async () =>
    unwrap<{ budget: Record<string, unknown> }>(
      await app
        .get(GetAvailableToSpendService)
        .execute({ workspaceId, sub: userId }),
    );

  const readPace = async () => {
    const now = new Date();
    return unwrap<{ planSource: string | null; planTotalCents: number | null }>(
      await app.get(GetMonthPaceService).execute({
        workspaceId,
        month: now.getUTCMonth() + 1,
        year: now.getUTCFullYear(),
      }),
    );
  };

  const acceptIncome = async (): Promise<void> => {
    const { income } = unwrap<{
      income: { status: string; fingerprint?: string };
    }>(await app.get(ResolveBudgetSuggestionService).execute({ workspaceId }));
    if (income.status !== 'pending' || !income.fingerprint) {
      throw new Error('income not pending');
    }
    unwrap(
      await app.get(AcceptIncomeSuggestionService).execute({
        workspaceId,
        fingerprint: income.fingerprint,
      }),
    );
  };

  const pendingSplit = async (): Promise<{ fingerprint: string }> => {
    const { split } = unwrap<{
      split: { status: string; fingerprint?: string };
    }>(await app.get(ResolveBudgetSuggestionService).execute({ workspaceId }));
    if (split.status !== 'pending' || !split.fingerprint) {
      throw new Error('split not pending');
    }
    return { fingerprint: split.fingerprint };
  };

  const seedHistory = async (): Promise<void> => {
    userId = randomUUID();
    const accountId = randomUUID();
    categoryId = randomUUID();
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

  beforeEach(async () => {
    await seedHistory();
    await acceptIncome();
  });

  const heroTotal = async (): Promise<unknown> =>
    (await readHero()).budget.totalTargetCents;

  it('serves the suggested plan on hero and pace with equal totals', async () => {
    const hero = await readHero();
    const pace = await readPace();

    expect(hero.budget).toMatchObject({ source: 'suggested' });
    expect(pace.planSource).toBe('suggested');
    expect(pace.planTotalCents).toBe(hero.budget.totalTargetCents);
  });

  it('serves hero and pace equal to a fresh read after renaming a mapped category', async () => {
    await readHero();
    await readPace();

    unwrap(
      await app.get(UpdateCategoryService).execute({
        id: categoryId,
        workspaceId,
        name: 'Moradia renomeada',
      } as never),
    );
    const served = [await readHero(), await readPace()];
    await valkey.flush();

    expect(served).toEqual([await readHero(), await readPace()]);
  });

  it('reads declared with the same total after accept-split', async () => {
    const suggestedTotal = await heroTotal();
    const { fingerprint } = await pendingSplit();

    unwrap(
      await app
        .get(AcceptSplitSuggestionService)
        .execute({ workspaceId, fingerprint }),
    );

    const hero = await readHero();
    const pace = await readPace();
    expect(hero.budget).toMatchObject({
      source: 'declared',
      totalTargetCents: suggestedTotal,
    });
    expect(pace).toMatchObject({
      planSource: 'declared',
      planTotalCents: suggestedTotal,
    });
  });

  it('reads provisional after a split rejection', async () => {
    await readHero();
    await readPace();

    unwrap(
      await app
        .get(RejectBudgetSuggestionService)
        .execute({ workspaceId, kind: 'split' }),
    );

    const hero = await readHero();
    const pace = await readPace();
    expect(hero.budget).toMatchObject({ source: 'provisional' });
    expect(pace.planSource).toBe('provisional');
    expect(pace.planTotalCents).toBe(hero.budget.totalTargetCents);
  });
});
