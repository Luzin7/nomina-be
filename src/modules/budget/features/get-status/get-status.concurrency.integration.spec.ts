import { TransactionType } from '@constants/enums';
import { DrizzleService } from '@infra/databases/drizzle/drizzle.service';
import { BudgetRepositoryImplementation } from '@infra/databases/drizzle/repositories/budget.repository';
import * as schema from '@infra/databases/drizzle/schema';
import { FindMonthSummaryService } from '@modules/report/features/get-month-summary/get-month-summary.service';
import { MonthProjection } from '@modules/report/valueObjects/MonthProjection';
import { MonthSummary } from '@modules/report/valueObjects/MonthSummary';
import { GetWorkspaceTimezoneService } from '@modules/workspace/services/get-workspace-timezone.service';
import { DayJsDateProvider } from '@providers/date/implementations/Dayjs';
import { right } from '@shared/core/errors/Either';
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
import { GetBudgetStatusService } from './get-status.handler';

type CategoryRow = typeof schema.categories.$inferInsert;
type CategoryFixture = CategoryRow & { id: string };

const MIGRATIONS_FOLDER = resolve(__dirname, '../../../../../drizzle');
const NOW = new Date('2026-11-10T12:00:00.000Z');
const NOVEMBER_START = new Date('2026-11-01T00:00:00.000Z');

const PROJECTION: MonthProjection = {
  expectedIncome: 100_000,
  expectedExpense: 60_000,
  expectedBalance: 40_000,
  realized: { totalIncome: 50_000, totalExpense: 20_000 },
  scheduled: { totalIncome: 0, totalExpense: 0 },
  recurringNotYetGenerated: { totalIncome: 0, totalExpense: 0 },
  fixedBillsDue: 5_000,
  accountedExpense: 20_000,
  variableRemaining: 10_000,
  paceDaily: 1_000,
  paceRemaining: 10_000,
  paceBalance: 5_000,
  daysRemaining: 10,
  usualExpense: 55_000,
  basisMonths: 3,
  hasHistory: true,
};

jest.setTimeout(180_000);

function makeExpenseCategory(overrides: Partial<CategoryRow>): CategoryFixture {
  return {
    id: randomUUID(),
    name: 'Moradia',
    type: TransactionType.EXPENSE,
    ...overrides,
  };
}

function makeSummary(): MonthSummary {
  return MonthSummary.create({
    month: NOVEMBER_START,
    totalIncome: 50_000,
    totalExpense: 20_000,
    totalCheckingBalance: 0,
    totalInvestmentBalance: 0,
    totalCreditCardBalance: 0,
    rate: { currentMonthSaving: 0, previousMonthCompareSaving: 0 },
    previousMonthToDate: { totalIncome: 0, totalExpense: 0 },
    projection: PROJECTION,
  });
}

describe('budget status over a hidden category', () => {
  let container: StartedPostgreSqlContainer;
  let queryClient: postgres.Sql;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  let service: GetBudgetStatusService;
  let workspaceId: string;
  let hiddenCategoryId: string;

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:16-alpine')
      .withStartupTimeout(120_000)
      .start();
    queryClient = postgres(container.getConnectionUri(), {
      max: 1,
      onnotice: () => undefined,
      connection: { TimeZone: 'UTC' },
    });
    db = drizzle(queryClient, { schema });
    await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });

    const dateProvider = new DayJsDateProvider();
    jest.spyOn(dateProvider, 'now').mockReturnValue(NOW);

    service = new GetBudgetStatusService(
      new BudgetRepositoryImplementation({ db } as unknown as DrizzleService),
      {
        execute: jest.fn().mockResolvedValue(right(makeSummary())),
      } as unknown as FindMonthSummaryService,
      {
        execute: jest.fn().mockResolvedValue('UTC'),
      } as unknown as GetWorkspaceTimezoneService,
      dateProvider,
    );
  });

  afterAll(async () => {
    await queryClient?.end({ timeout: 5 });
    await container?.stop();
  });

  beforeEach(async () => {
    await db.execute(
      sql`TRUNCATE workspaces, categories, budgets, budget_allocations RESTART IDENTITY CASCADE`,
    );

    workspaceId = randomUUID();
    const housing = makeExpenseCategory({ workspaceId, name: 'Moradia' });
    const petshop = makeExpenseCategory({ workspaceId, name: 'Petshop' });
    hiddenCategoryId = petshop.id;

    await db.insert(schema.workspaces).values({ id: workspaceId, name: 'WS' });
    await db.insert(schema.categories).values([housing, petshop]);

    const [budget] = await db
      .insert(schema.budgets)
      .values({
        workspaceId,
        effectiveFrom: NOVEMBER_START,
        monthlyIncome: 100_000,
      })
      .returning({ id: schema.budgets.id });

    await db.insert(schema.budgetAllocations).values([
      {
        budgetId: budget.id,
        categoryId: housing.id,
        groupName: 'Custos fixos',
        groupOrder: 0,
        categoryOrder: 0,
        percentageOfIncome: 60,
        targetCents: 60_000,
      },
      {
        budgetId: budget.id,
        categoryId: petshop.id,
        groupName: 'Conforto',
        groupOrder: 1,
        categoryOrder: 0,
        percentageOfIncome: 40,
        targetCents: 40_000,
      },
    ]);
  });

  it('resolves a snapshot that allocates a now hidden category unchanged', async () => {
    const request = { workspaceId, sub: 'user-1', month: 11, year: 2026 };

    const before = await service.execute(request);
    await db
      .update(schema.categories)
      .set({ isHidden: true })
      .where(eq(schema.categories.id, hiddenCategoryId));
    const after = await service.execute(request);

    expect(after.isRight() && after.value).toEqual(
      before.isRight() && before.value,
    );
    if (!after.isRight() || !after.value.exists) return;
    expect(after.value.allocations.map((item) => item.categoryName)).toEqual([
      'Moradia',
      'Petshop',
    ]);
    expect(
      after.value.allocations.reduce(
        (total, item) => total + item.targetCents,
        0,
      ),
    ).toBe(after.value.totalTargetCents);
    expect(after.value.pillars.map((pillar) => pillar.percentage)).toEqual([
      60, 40,
    ]);
    expect(after.value.projection?.paceDaily).toBe(1_000);
  });
});
