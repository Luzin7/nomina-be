import { TransactionStatus, TransactionType } from '@constants/enums';
import { DrizzleService } from '@infra/databases/drizzle/drizzle.service';
import { BudgetRepositoryImplementation } from '@infra/databases/drizzle/repositories/budget.repository';
import { MonthProjectionRepositoryImplementation } from '@infra/databases/drizzle/repositories/month-projection.repository';
import * as schema from '@infra/databases/drizzle/schema';
import { BudgetResetConstraintError } from '@modules/budget/errors';
import { toAllocationInputs } from '@modules/budget/valueObjects/SplitAllocationLayout';
import {
  ResolveBudgetSuggestionService,
  type BudgetSuggestion,
} from '@modules/budget/services/resolve-budget-suggestion.service';
import { GetWorkspaceTimezoneService } from '@modules/workspace/services/get-workspace-timezone.service';
import { DayJsDateProvider } from '@providers/date/implementations/Dayjs';
import { InMemoryCacheProvider } from '@shared/cache/test-helpers/in-memory-cache';
import { SingleFlight } from '@shared/cache/single-flight';
import { type TokenPayloadSchema } from '@providers/auth/strategys/jwtStrategy';
import {
  PostgreSqlContainer,
  StartedPostgreSqlContainer,
} from '@testcontainers/postgresql';
import { UnprocessableEntityException } from '@nestjs/common';
import { and, asc, eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import postgres from 'postgres';
import { ResetBudgetController } from './reset-budget.controller';
import { ResetBudgetService } from './reset-budget.handler';

type Database = ReturnType<typeof drizzle<typeof schema>>;

const MIGRATIONS_FOLDER = resolve(__dirname, '../../../../../drizzle');
const INCOME_CENTS = 400_000;
const PREVIOUS_TARGET_CENTS = 100_000;
const DRIFTED_INCOME_CENTS = 900_000;

jest.setTimeout(180_000);

const dayOf = (monthStart: Date, day: number): Date =>
  new Date(
    Date.UTC(monthStart.getUTCFullYear(), monthStart.getUTCMonth(), day, 12),
  );

describe('budget reset against a real postgres', () => {
  let container: StartedPostgreSqlContainer;
  let queryClient: postgres.Sql;
  let db: Database;
  let dateProvider: DayJsDateProvider;
  let budgetRepository: BudgetRepositoryImplementation;
  let cache: InMemoryCacheProvider;
  let resolveSuggestion: ResolveBudgetSuggestionService;
  let workspaceId: string;
  let categoryId: string;
  let currentMonthStart: Date;

  const makeController = (resolver = resolveSuggestion) =>
    new ResetBudgetController(
      new ResetBudgetService(resolver, budgetRepository, cache),
    );

  const reset = (resolver?: ResolveBudgetSuggestionService) =>
    makeController(resolver).handle({ workspaceId } as TokenPayloadSchema);

  const storedPlanOf = async (): Promise<BudgetSuggestion> => {
    const result = await resolveSuggestion.execute({ workspaceId });
    if (result.isLeft()) throw result.value;

    return result.value;
  };

  const givenAcceptedSplitIn = async (month: string) => {
    await db.insert(schema.budgetSuggestionDecisions).values({
      workspaceId,
      kind: 'split',
      month: `${month}-01`,
      decision: 'accepted',
      incomeCents: INCOME_CENTS,
      bracketVersion: 1,
    });
  };

  const previousMonth = () =>
    dateProvider.format(
      dateProvider.add(currentMonthStart, -1, 'month', 'UTC'),
      'YYYY-MM',
      'UTC',
    );

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:16-alpine')
      .withStartupTimeout(120_000)
      .start();
    queryClient = postgres(container.getConnectionUri(), {
      max: 5,
      onnotice: () => undefined,
      connection: { TimeZone: 'UTC' },
    });
    db = drizzle(queryClient, { schema });
    await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });

    dateProvider = new DayJsDateProvider();
    const drizzleService = new DrizzleService(db);
    budgetRepository = new BudgetRepositoryImplementation(drizzleService);
    cache = new InMemoryCacheProvider();
    resolveSuggestion = new ResolveBudgetSuggestionService(
      budgetRepository,
      new MonthProjectionRepositoryImplementation(drizzleService),
      {
        execute: jest.fn().mockResolvedValue('UTC'),
      } as unknown as GetWorkspaceTimezoneService,
      dateProvider,
      cache,
      new SingleFlight(),
    );
  });

  afterAll(async () => {
    await queryClient.end({ timeout: 5 });
    await container.stop();
  });

  beforeEach(async () => {
    await db.execute(
      sql`TRUNCATE workspaces, categories, budgets, budget_allocations,
        budget_suggestion_decisions, budget_parameters, budget_income_brackets,
        budget_category_groups RESTART IDENTITY CASCADE`,
    );

    workspaceId = randomUUID();
    categoryId = randomUUID();
    const accountId = randomUUID();
    currentMonthStart = dateProvider.startOfMonth(dateProvider.now(), 'UTC');

    await db
      .insert(schema.workspaces)
      .values({ id: workspaceId, name: 'Workspace' });
    await db.insert(schema.accounts).values({
      id: accountId,
      workspaceId,
      name: 'Conta',
      type: 'CHECKING',
    });
    await db.insert(schema.categories).values({
      id: categoryId,
      workspaceId,
      name: 'Moradia',
      type: TransactionType.EXPENSE,
    });
    await db.insert(schema.budgetParameters).values({
      key: 'minimum_wage',
      effectiveFrom: dateProvider.format(
        currentMonthStart,
        'YYYY-MM-DD',
        'UTC',
      ),
      valueCents: 100_000,
    });
    await db.insert(schema.budgetIncomeBrackets).values({
      version: 1,
      position: 1,
      maxMinimumWages: null,
      essentialsBp: 10_000,
      lifestyleBp: 0,
      savingsBp: 0,
    });
    await db
      .insert(schema.budgetCategoryGroups)
      .values({ categoryName: 'Moradia', budgetGroup: 'essentials' });

    for (let age = 1; age <= 3; age++) {
      const monthStart = dateProvider.startOfMonth(
        dateProvider.add(currentMonthStart, -age, 'month', 'UTC'),
        'UTC',
      );
      await db.insert(schema.transactions).values(
        [1, 2, 3, 4, 5].map((day) => ({
          workspaceId,
          accountId,
          categoryId,
          title: 'Moradia',
          amount: 1_000,
          date: dayOf(monthStart, day),
          type: TransactionType.EXPENSE,
          status: TransactionStatus.COMPLETED,
        })),
      );
    }

    await givenMonthBudget('fixed');
  });

  const givenMonthBudget = async (mode: 'fixed' | 'percentage') => {
    const [budget] = await db
      .insert(schema.budgets)
      .values({
        workspaceId,
        effectiveFrom: currentMonthStart,
        monthlyIncome: INCOME_CENTS,
        mode,
      })
      .returning({ id: schema.budgets.id });
    await db.insert(schema.budgetAllocations).values({
      budgetId: budget.id,
      categoryId,
      groupName: 'Geral',
      groupOrder: 0,
      categoryOrder: 0,
      percentageOfIncome: null,
      targetCents: PREVIOUS_TARGET_CENTS,
    });

    return budget.id;
  };

  const monthBudget = async () => {
    const [budget] = await db
      .select()
      .from(schema.budgets)
      .where(
        and(
          eq(schema.budgets.workspaceId, workspaceId),
          eq(schema.budgets.effectiveFrom, currentMonthStart),
        ),
      );

    return budget;
  };

  const allocationsOfMonth = async () => {
    const budget = await monthBudget();

    return db
      .select({
        categoryId: schema.budgetAllocations.categoryId,
        groupName: schema.budgetAllocations.groupName,
        groupOrder: schema.budgetAllocations.groupOrder,
        categoryOrder: schema.budgetAllocations.categoryOrder,
        targetCents: schema.budgetAllocations.targetCents,
      })
      .from(schema.budgetAllocations)
      .where(eq(schema.budgetAllocations.budgetId, budget.id))
      .orderBy(
        asc(schema.budgetAllocations.groupOrder),
        asc(schema.budgetAllocations.categoryOrder),
      );
  };

  const decisionsOf = () =>
    db
      .select()
      .from(schema.budgetSuggestionDecisions)
      .where(eq(schema.budgetSuggestionDecisions.workspaceId, workspaceId));

  it('writes byte-identical allocations on two consecutive resets', async () => {
    const first = await reset();
    const firstAllocations = await allocationsOfMonth();

    const second = await reset();

    expect(second).toEqual(first);
    expect(await allocationsOfMonth()).toEqual(firstAllocations);
    expect(firstAllocations[0].targetCents).not.toBe(PREVIOUS_TARGET_CENTS);
    expect(await decisionsOf()).toHaveLength(1);
  });

  it('keeps the stored-baseline categories and re-anchors their targets on the observed spend', async () => {
    const offered = toAllocationInputs(
      (await storedPlanOf()).plan?.allocations ?? [],
    );

    const payload = await reset();

    const written = await allocationsOfMonth();
    expect(written.map(({ categoryId }) => categoryId)).toEqual(
      offered.map(({ categoryId }) => categoryId),
    );
    expect(written.map(({ targetCents }) => targetCents)).not.toEqual(
      offered.map(({ targetCents }) => targetCents),
    );
    expect(payload.totalTargetCents).toBe(
      written.reduce((total, { targetCents }) => total + targetCents, 0),
    );
  });

  it('keeps a percentage-mode month in percentage mode', async () => {
    await db.execute(
      sql`TRUNCATE budgets, budget_allocations, budget_suggestion_decisions CASCADE`,
    );
    await givenMonthBudget('percentage');

    const payload = await reset();

    expect(payload.mode).toBe('percentage');
    expect((await monthBudget()).mode).toBe('percentage');
  });

  it('answers 409 and writes nothing when the plan drifted', async () => {
    let calls = 0;
    const driftingResolver = {
      resolveFromBlankBaseline: async (request: TokenPayloadSchema) => {
        calls += 1;
        if (calls === 2) {
          await db
            .update(schema.budgets)
            .set({ monthlyIncome: DRIFTED_INCOME_CENTS })
            .where(eq(schema.budgets.workspaceId, workspaceId));
        }

        return resolveSuggestion.resolveFromBlankBaseline(request);
      },
    } as unknown as ResolveBudgetSuggestionService;

    const attempt = reset(driftingResolver);

    await expect(attempt).rejects.toMatchObject({ status: 409 });
    expect((await allocationsOfMonth())[0].targetCents).toBe(
      PREVIOUS_TARGET_CENTS,
    );
    expect(await decisionsOf()).toHaveLength(0);
  });

  it('answers 409 and writes nothing when only the glide step of the split changed', async () => {
    let calls = 0;
    const steppingResolver = {
      resolveFromBlankBaseline: async (request: TokenPayloadSchema) => {
        calls += 1;
        if (calls === 2) await givenAcceptedSplitIn(previousMonth());

        return resolveSuggestion.resolveFromBlankBaseline(request);
      },
    } as unknown as ResolveBudgetSuggestionService;

    const attempt = reset(steppingResolver);

    await expect(attempt).rejects.toMatchObject({ status: 409 });
    expect((await monthBudget()).monthlyIncome).toBe(INCOME_CENTS);
    expect((await allocationsOfMonth())[0].targetCents).toBe(
      PREVIOUS_TARGET_CENTS,
    );
    expect((await decisionsOf()).map(({ kind }) => kind)).toEqual(['split']);
  });

  it('answers 422 when the ledger has no completed expenses', async () => {
    await db.delete(schema.transactions);

    await expect(reset()).rejects.toBeInstanceOf(UnprocessableEntityException);
    expect((await allocationsOfMonth())[0].targetCents).toBe(
      PREVIOUS_TARGET_CENTS,
    );
  });

  it('answers 503 when another transaction holds the workspace lock', async () => {
    const holder = postgres(container.getConnectionUri(), {
      max: 1,
      onnotice: () => undefined,
    });

    try {
      await holder.begin(async (tx) => {
        await tx`SELECT pg_advisory_xact_lock(hashtext(${workspaceId}))`;

        await expect(reset()).rejects.toMatchObject({ status: 503 });
      });
    } finally {
      await holder.end({ timeout: 5 });
    }

    expect((await allocationsOfMonth())[0].targetCents).toBe(
      PREVIOUS_TARGET_CENTS,
    );
  });

  it('maps a check violation to a named error', async () => {
    await db.execute(
      sql`ALTER TABLE budget_suggestion_decisions DROP CONSTRAINT chk_budget_suggestion_decision_kind`,
    );
    await db.execute(
      sql`ALTER TABLE budget_suggestion_decisions ADD CONSTRAINT chk_budget_suggestion_decision_kind CHECK (kind IN ('income', 'split'))`,
    );

    try {
      await expect(
        budgetRepository.resetSnapshot({
          workspaceId,
          effectiveFrom: currentMonthStart,
          decision: {
            workspaceId,
            kind: 'reset',
            month: dateProvider.format(currentMonthStart, 'YYYY-MM', 'UTC'),
            decision: 'accepted',
            incomeCents: INCOME_CENTS,
            bracketVersion: null,
          },
          allocations: [
            {
              categoryId,
              groupName: 'Essenciais',
              groupOrder: 0,
              categoryOrder: 0,
              targetCents: INCOME_CENTS,
            },
          ],
          isStillCurrent: async () => true,
        }),
      ).rejects.toBeInstanceOf(BudgetResetConstraintError);
    } finally {
      await db.execute(
        sql`ALTER TABLE budget_suggestion_decisions DROP CONSTRAINT chk_budget_suggestion_decision_kind`,
      );
      await db.execute(
        sql`ALTER TABLE budget_suggestion_decisions ADD CONSTRAINT chk_budget_suggestion_decision_kind CHECK (kind IN ('income', 'split', 'reset'))`,
      );
    }
  });
});
