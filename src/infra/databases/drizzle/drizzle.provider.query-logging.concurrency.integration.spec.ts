import { env } from '@infra/env';
import {
  PostgreSqlContainer,
  StartedPostgreSqlContainer,
} from '@testcontainers/postgresql';
import { Logger } from '@nestjs/common';
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

  it('should not introspect pg_type after the first query', async () => {
    const debugSpy = jest.spyOn(Logger.prototype, 'debug');

    await Promise.all(
      Array.from({ length: 5 }, () =>
        provider.db.execute(sql`SELECT pg_sleep(0.3)`),
      ),
    );

    const loggedQueries = debugSpy.mock.calls.map(([message]) =>
      String(message),
    );
    debugSpy.mockRestore();
    expect(loggedQueries.length).toBeGreaterThan(0);
    expect(loggedQueries.some((q) => q.includes('pg_catalog.pg_type'))).toBe(
      false,
    );
  });
});
