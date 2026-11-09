import { TransactionType } from '@constants/enums';
import { DrizzleService } from '@infra/databases/drizzle/drizzle.service';
import * as schema from '@infra/databases/drizzle/schema';
import {
  PostgreSqlContainer,
  StartedPostgreSqlContainer,
} from '@testcontainers/postgresql';
import { eq, sql, sum } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import postgres from 'postgres';
import { BudgetRepositoryImplementation } from './budget.repository';

type Database = ReturnType<typeof drizzle<typeof schema>>;

const MIGRATIONS_FOLDER = resolve(__dirname, '../../../../../drizzle');

const JANUARY = new Date('2026-01-01T03:00:00.000Z');
const MARCH = new Date('2026-03-01T03:00:00.000Z');

jest.setTimeout(180_000);

describe('BudgetRepositoryImplementation against a real postgres', () => {
  let container: StartedPostgreSqlContainer;
  let queryClient: postgres.Sql;
  let db: Database;
  let repository: BudgetRepositoryImplementation;
  let workspaceId: string;
  let categoryId: string;
  let secondCategoryId: string;

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

    repository = new BudgetRepositoryImplementation({
      db,
    } as unknown as DrizzleService);
  });

  afterAll(async () => {
    await queryClient.end({ timeout: 5 });
    await container.stop();
  });

  beforeEach(async () => {
    await db.execute(
      sql`TRUNCATE workspaces, categories, budgets, budget_allocations RESTART IDENTITY CASCADE`,
    );

    workspaceId = randomUUID();
    categoryId = randomUUID();
    secondCategoryId = randomUUID();

    await db.insert(schema.workspaces).values({
      id: workspaceId,
      name: 'Workspace',
    });
    await db.insert(schema.categories).values([
      {
        id: categoryId,
        workspaceId,
        name: 'Moradia',
        type: TransactionType.EXPENSE,
      },
      {
        id: secondCategoryId,
        workspaceId,
        name: 'Lazer',
        type: TransactionType.EXPENSE,
      },
    ]);
  });

  async function snapshotCount(): Promise<number> {
    const [row] = await db
      .select({ count: sql<number>`COUNT(*)`.mapWith(Number) })
      .from(schema.budgets)
      .where(eq(schema.budgets.workspaceId, workspaceId));

    return row.count;
  }

  it('serializes two parallel saves into one consistent snapshot', async () => {
    const save = (monthlyIncome: number, percentage: number) =>
      repository.saveSnapshot({
        workspaceId,
        effectiveFrom: JANUARY,
        monthlyIncome,
        allocations: [
          {
            categoryId,
            groupName: 'Custos fixos',
            groupOrder: 0,
            categoryOrder: 0,
            percentageOfIncome: percentage,
            targetCents: Math.round((monthlyIncome * percentage) / 100),
          },
          {
            categoryId: secondCategoryId,
            groupName: 'Conforto',
            groupOrder: 1,
            categoryOrder: 1,
            percentageOfIncome: 100 - percentage,
            targetCents:
              monthlyIncome - Math.round((monthlyIncome * percentage) / 100),
          },
        ],
      });

    await Promise.allSettled([save(100_000, 60), save(200_000, 30)]);

    expect(await snapshotCount()).toBe(1);

    const [snapshot] = await db
      .select()
      .from(schema.budgets)
      .where(eq(schema.budgets.workspaceId, workspaceId));

    const allocations = await db
      .select()
      .from(schema.budgetAllocations)
      .where(eq(schema.budgetAllocations.budgetId, snapshot.id));

    expect(allocations).toHaveLength(2);
    expect(
      allocations.reduce(
        (total, allocation) => total + allocation.percentageOfIncome,
        0,
      ),
    ).toBe(100);
    expect(
      allocations.reduce(
        (total, allocation) => total + allocation.targetCents,
        0,
      ),
    ).toBe(snapshot.monthlyIncome);

    const [totals] = await db
      .select({ total: sum(schema.budgetAllocations.percentageOfIncome) })
      .from(schema.budgetAllocations)
      .where(eq(schema.budgetAllocations.budgetId, snapshot.id));
    expect(Number(totals.total)).toBe(100);
  });

  it('resolves the latest snapshot at or before the month', async () => {
    await repository.saveSnapshot({
      workspaceId,
      effectiveFrom: JANUARY,
      monthlyIncome: 100_000,
      allocations: [],
    });
    await repository.saveSnapshot({
      workspaceId,
      effectiveFrom: MARCH,
      monthlyIncome: 200_000,
      allocations: [],
    });

    const february = await repository.resolveSnapshot(
      workspaceId,
      new Date('2026-02-01T03:00:00.000Z'),
    );
    const march = await repository.resolveSnapshot(workspaceId, MARCH);
    const before = await repository.resolveSnapshot(
      workspaceId,
      new Date('2025-12-01T03:00:00.000Z'),
    );

    expect(february?.effectiveFrom).toEqual(JANUARY);
    expect(march?.effectiveFrom).toEqual(MARCH);
    expect(before).toBeNull();
  });
});
