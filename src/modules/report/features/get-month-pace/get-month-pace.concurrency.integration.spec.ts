import {
  RecurrenceFrequency,
  TransactionStatus,
  TransactionType,
} from '@constants/enums';
import * as schema from '@infra/databases/drizzle/schema';
import { AccountRepository } from '@modules/account/repositories/contracts/AccountRepository';
import { makeCheckingAccount } from '@modules/account/test-helpers/mock-factories';
import { GetBudgetStatusService } from '@modules/budget/features/get-status/get-status.handler';
import { Category } from '@modules/category/entities/Category';
import { CategoryRepository } from '@modules/category/repositories/contracts/CategoryRepository';
import { Workspace } from '@modules/workspace/entities/Workspace';
import { WorkspaceRepository } from '@modules/workspace/repositories/contracts/WorkspaceRepository';
import { InMemoryCacheProvider } from '@shared/cache/test-helpers/in-memory-cache';
import {
  ApplicationHandle,
  createApplication,
  PostgresHandle,
  startPostgres,
} from '@shared/cache/test-helpers/freshness-harness';
import { randomUUID } from 'node:crypto';
import { GetMonthPaceService } from './get-month-pace.handler';

const TIMEZONE = 'America/Sao_Paulo';
const MONTH = { month: 2, year: 2026 };
const PLAN_CENTS = 300_000;
const RENT_CENTS = 100_000;

jest.setTimeout(180_000);

function unwrap<T>(result: { isLeft(): boolean; value: unknown }): T {
  if (result.isLeft()) throw result.value;
  return result.value as T;
}

describe('month pace against a real database', () => {
  let postgres: PostgresHandle;
  let app: ApplicationHandle;

  beforeAll(async () => {
    postgres = await startPostgres();
    app = await createApplication(postgres.db, new InMemoryCacheProvider());
  });

  afterAll(async () => {
    await app?.close();
    await postgres?.stop();
  });

  async function seedWorkspace() {
    const workspaceId = randomUUID();
    const userId = randomUUID();
    const accountId = randomUUID();
    const categoryId = randomUUID();
    await postgres.db.insert(schema.users).values({
      id: userId,
      email: `${userId}@example.com`,
      passwordHash: 'hash',
      name: 'Pace',
    });
    await app
      .get(WorkspaceRepository)
      .create(
        unwrap<Workspace>(
          Workspace.create({ name: 'Pace', timezone: TIMEZONE }, workspaceId),
        ),
      );
    await app.get(AccountRepository).create(
      makeCheckingAccount({
        id: accountId,
        workspaceId,
        name: 'Conta',
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

    return { workspaceId, userId, accountId, categoryId };
  }

  async function spend(
    seed: Awaited<ReturnType<typeof seedWorkspace>>,
    date: string,
    amount: number,
  ) {
    await postgres.db.insert(schema.transactions).values({
      workspaceId: seed.workspaceId,
      accountId: seed.accountId,
      categoryId: seed.categoryId,
      title: 'Gasto',
      amount,
      date: new Date(date),
      type: TransactionType.EXPENSE,
      status: TransactionStatus.COMPLETED,
    });
  }

  async function saveBudget(
    seed: Awaited<ReturnType<typeof seedWorkspace>>,
  ): Promise<void> {
    const budgetId = randomUUID();
    await postgres.db.insert(schema.budgets).values({
      id: budgetId,
      workspaceId: seed.workspaceId,
      effectiveFrom: new Date('2026-02-01T03:00:00.000Z'),
      monthlyIncome: 500_000,
      mode: 'fixed',
    });
    await postgres.db.insert(schema.budgetAllocations).values({
      budgetId,
      categoryId: seed.categoryId,
      groupName: 'Essenciais',
      groupOrder: 0,
      categoryOrder: 0,
      percentageOfIncome: 60,
      targetCents: PLAN_CENTS,
    });
  }

  const readPace = async (workspaceId: string) =>
    unwrap<{
      daysInMonth: number;
      planTotalCents: number | null;
      days: {
        day: number;
        spentCents: number | null;
        planCents: number | null;
      }[];
    }>(await app.get(GetMonthPaceService).execute({ workspaceId, ...MONTH }));

  it('returns every day of a past month with the last plan equal to the total', async () => {
    const seed = await seedWorkspace();
    await saveBudget(seed);

    const pace = await readPace(seed.workspaceId);

    expect(pace.days).toHaveLength(28);
    expect(pace.days.at(-1)?.planCents).toBe(PLAN_CENTS);
    expect(pace.planTotalCents).toBe(PLAN_CENTS);
  });

  it('returns null plan fields when the workspace has no budget', async () => {
    const seed = await seedWorkspace();

    const pace = await readPace(seed.workspaceId);

    expect(pace.planTotalCents).toBeNull();
    expect(pace.days.every(({ planCents }) => planCents === null)).toBe(true);
  });

  it('ends with the same spent total as budget status', async () => {
    const seed = await seedWorkspace();
    await saveBudget(seed);
    await spend(seed, '2026-02-03T15:00:00.000Z', 12_345);
    await spend(seed, '2026-02-20T15:00:00.000Z', 6_789);

    const pace = await readPace(seed.workspaceId);
    const status = unwrap<{ totalSpent: number }>(
      await app.get(GetBudgetStatusService).execute({
        workspaceId: seed.workspaceId,
        sub: seed.userId,
        ...MONTH,
      }),
    );

    expect(pace.days.at(-1)?.spentCents).toBe(status.totalSpent);
    expect(status.totalSpent).toBe(19_134);
  });

  it('makes the plan jump on the day a rent rule falls', async () => {
    const seed = await seedWorkspace();
    await saveBudget(seed);
    await postgres.db.insert(schema.recurringTransactions).values({
      workspaceId: seed.workspaceId,
      accountId: seed.accountId,
      categoryId: seed.categoryId,
      type: TransactionType.EXPENSE,
      title: 'Aluguel',
      amount: RENT_CENTS,
      frequency: RecurrenceFrequency.MONTHLY,
      interval: 1,
      startDate: new Date('2026-02-05T15:00:00.000Z'),
      active: true,
    });

    const { days } = await readPace(seed.workspaceId);
    const planOn = (day: number) => days[day - 1].planCents ?? 0;

    expect(planOn(4) - planOn(3)).toBeLessThan(RENT_CENTS);
    expect(planOn(5) - planOn(4)).toBeGreaterThanOrEqual(RENT_CENTS);
    expect(planOn(6) - planOn(5)).toBeLessThan(RENT_CENTS);
  });

  it('counts 23:30 local on the last day as the last day', async () => {
    const seed = await seedWorkspace();
    await spend(seed, '2026-03-01T02:30:00.000Z', 700);
    await spend(seed, '2026-03-01T03:30:00.000Z', 900);

    const { days } = await readPace(seed.workspaceId);
    const onLastDay =
      (days.at(-1)?.spentCents ?? 0) - (days.at(-2)?.spentCents ?? 0);

    expect(onLastDay).toBe(700);
    expect(days.at(-1)?.spentCents).toBe(700);
  });
});
