import { env } from '@infra/env';
import {
  PostgreSqlContainer,
  StartedPostgreSqlContainer,
} from '@testcontainers/postgresql';
import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import { DrizzleProvider } from './drizzle.provider';

jest.setTimeout(180_000);

describe('DrizzleProvider session time zone', () => {
  let container: StartedPostgreSqlContainer;
  let provider: DrizzleProvider;
  let previousUrl: string;

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:16-alpine')
      .withStartupTimeout(120_000)
      .start();

    const admin = postgres(container.getConnectionUri(), { max: 1 });
    await admin.unsafe(
      `ALTER DATABASE "${container.getDatabase()}" SET timezone = 'Asia/Tokyo'`,
    );
    await admin.end({ timeout: 5 });

    previousUrl = env.DATABASE_URL;
    env.DATABASE_URL = container.getConnectionUri();
    provider = new DrizzleProvider();
  });

  afterAll(async () => {
    env.DATABASE_URL = previousUrl;
    await provider?.onModuleDestroy();
    await container?.stop();
  });

  it('should open sessions in UTC even when the database default is another zone', async () => {
    const [row] = await provider.db.execute<{ TimeZone: string }>(
      sql`SHOW TIME ZONE`,
    );

    expect(row?.TimeZone).toBe('UTC');
  });
});
