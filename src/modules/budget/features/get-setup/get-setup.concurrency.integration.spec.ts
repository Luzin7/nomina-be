import { TransactionType } from '@constants/enums';
import { DrizzleService } from '@infra/databases/drizzle/drizzle.service';
import { BudgetRepositoryImplementation } from '@infra/databases/drizzle/repositories/budget.repository';
import * as schema from '@infra/databases/drizzle/schema';
import {
  PostgreSqlContainer,
  StartedPostgreSqlContainer,
} from '@testcontainers/postgresql';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import postgres from 'postgres';
import { GetBudgetSetupService } from './get-setup.handler';

type CategoryRow = typeof schema.categories.$inferInsert;

const MIGRATIONS_FOLDER = resolve(__dirname, '../../../../../drizzle');

jest.setTimeout(180_000);

function makeExpenseCategory(overrides: Partial<CategoryRow>): CategoryRow {
  return {
    id: randomUUID(),
    name: 'Moradia',
    type: TransactionType.EXPENSE,
    ...overrides,
  };
}

describe('budget setup allocation offer', () => {
  let container: StartedPostgreSqlContainer;
  let queryClient: postgres.Sql;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  let service: GetBudgetSetupService;

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
    service = new GetBudgetSetupService(
      new BudgetRepositoryImplementation({ db } as unknown as DrizzleService),
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
  });

  it('omits a hidden expense category from the allocation offer', async () => {
    const workspaceId = randomUUID();
    const visible = makeExpenseCategory({ workspaceId, name: 'Moradia' });
    const hidden = makeExpenseCategory({
      workspaceId,
      name: 'Petshop',
      isHidden: true,
    });

    await db.insert(schema.workspaces).values({ id: workspaceId, name: 'WS' });
    await db.insert(schema.categories).values([visible, hidden]);

    const result = await service.execute({ workspaceId });

    expect(result.isRight()).toBe(true);
    if (!result.isRight()) return;
    expect(result.value.allocations.map((item) => item.categoryId)).toEqual([
      visible.id,
    ]);
  });
});
