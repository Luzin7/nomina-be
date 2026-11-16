import { TransactionType } from '@constants/enums';
import { DRIZZLE_TOKEN } from '@infra/databases/drizzle/drizzle.provider';
import { DrizzleService } from '@infra/databases/drizzle/drizzle.service';
import * as schema from '@infra/databases/drizzle/schema';
import { DEFAULT_CATEGORIES } from '@modules/category/constants/default-categories';
import { Test, TestingModule } from '@nestjs/testing';
import {
  PostgreSqlContainer,
  StartedPostgreSqlContainer,
} from '@testcontainers/postgresql';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { resolve } from 'node:path';
import postgres from 'postgres';
import { BudgetRepositoryImplementation } from './budget.repository';

jest.mock('@sentry/nestjs', () => ({ captureException: jest.fn() }));

const MIGRATIONS_FOLDER = resolve(__dirname, '../../../../../drizzle');
const AS_OF = '2026-11-15';

jest.setTimeout(180_000);

describe('budget category groups seed', () => {
  let container: StartedPostgreSqlContainer;
  let queryClient: postgres.Sql;
  let moduleRef: TestingModule;
  let repository: BudgetRepositoryImplementation;

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:17-alpine')
      .withStartupTimeout(120_000)
      .start();
    queryClient = postgres(container.getConnectionUri(), {
      max: 5,
      onnotice: () => undefined,
    });
    const drizzleDb = drizzle(queryClient, { schema });
    await migrate(drizzleDb, { migrationsFolder: MIGRATIONS_FOLDER });

    moduleRef = await Test.createTestingModule({
      providers: [
        DrizzleService,
        { provide: DRIZZLE_TOKEN, useValue: drizzleDb },
        BudgetRepositoryImplementation,
      ],
    }).compile();

    repository = moduleRef.get(BudgetRepositoryImplementation);
  });

  afterAll(async () => {
    await moduleRef.close();
    await queryClient.end({ timeout: 5 });
    await container.stop();
  });

  it('resolves a group for every seeded EXPENSE root', async () => {
    const { groupByCategoryName } =
      await repository.findSuggestionParameters(AS_OF);
    const roots = DEFAULT_CATEGORIES.filter(
      (node) => node.type === TransactionType.EXPENSE,
    ).map((node) => node.name);

    expect(
      roots.filter((root) => (groupByCategoryName[root] ?? null) === null),
    ).toEqual([]);
  });

  it('maps the taxonomy roots added by 0048', async () => {
    const { groupByCategoryName } =
      await repository.findSuggestionParameters(AS_OF);

    expect(groupByCategoryName).toMatchObject({
      Supermercado: 'essentials',
      Telefonia: 'essentials',
      Pets: 'essentials',
      Presentes: 'lifestyle',
    });
  });
});
