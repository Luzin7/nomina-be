import { env } from '@infra/env';
import {
  PostgreSqlContainer,
  StartedPostgreSqlContainer,
} from '@testcontainers/postgresql';
import { sql } from 'drizzle-orm';
import { DrizzleProvider } from './drizzle.provider';

jest.setTimeout(180_000);

describe('DrizzleProvider query logging', () => {
  let container: StartedPostgreSqlContainer;
  let provider: DrizzleProvider;
  let previousUrl: string;
  let previousNodeEnv: typeof env.NODE_ENV;

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:16-alpine')
      .withStartupTimeout(120_000)
      .start();

    previousUrl = env.DATABASE_URL;
    previousNodeEnv = env.NODE_ENV;
    env.DATABASE_URL = container.getConnectionUri();
    env.NODE_ENV = 'dev';
    provider = new DrizzleProvider();
  });

  afterAll(async () => {
    env.DATABASE_URL = previousUrl;
    env.NODE_ENV = previousNodeEnv;
    await provider.onModuleDestroy();
    await container.stop();
  });

  it('should run a query with a bigint param in dev', async () => {
    const [row] = await provider.db.execute<{ total: string }>(
      sql`SELECT (${5000n}::bigint + 1) AS total`,
    );

    expect(row.total).toBe('5001');
  });
});
