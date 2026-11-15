import { CacheProvider } from '@infra/cache/contracts/CacheProvider';
import { RedisService } from '@infra/cache/redis/RedisService';
import { RedisModule } from '@infra/cache/Redis.module';
import { DatabaseModule } from '@infra/databases/Database.module';
import { DRIZZLE_TOKEN } from '@infra/databases/drizzle/drizzle.provider';
import * as schema from '@infra/databases/drizzle/schema';
import { env } from '@infra/env';
import { AccountModule } from '@modules/account/Account.module';
import { BudgetModule } from '@modules/budget/Budget.module';
import { CardCycleModule } from '@modules/card-cycle/CardCycle.module';
import { CategoryModule } from '@modules/category/Category.module';
import { DashboardModule } from '@modules/dashboard/Dashboard.module';
import { GoalModule } from '@modules/goal/Goal.module';
import { ReportModule } from '@modules/report/Report.module';
import { TransactionModule } from '@modules/transaction/Transaction.module';
import { WorkspaceModule } from '@modules/workspace/Workspace.module';
import { Type } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import { DateModule } from '@providers/date/Date.module';
import {
  PostgreSqlContainer,
  StartedPostgreSqlContainer,
} from '@testcontainers/postgresql';
import { drizzle, PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { resolve } from 'node:path';
import postgres from 'postgres';
import { GenericContainer, StartedTestContainer } from 'testcontainers';

const MIGRATIONS_FOLDER = resolve(__dirname, '../../../../drizzle');
const VALKEY_IMAGE = 'valkey/valkey:8.1-alpine';
const VALKEY_PORT = 6379;
const READY_TIMEOUT_MS = 5000;
const READY_POLL_MS = 50;

export type TestDatabase = PostgresJsDatabase<typeof schema>;

export interface PostgresHandle {
  db: TestDatabase;
  stop(): Promise<void>;
}

export interface ValkeyHandle {
  cache: RedisService;
  flush(): Promise<void>;
  stop(): Promise<void>;
}

export interface ApplicationHandle {
  get<T>(token: { prototype: T }): T;
  close(): Promise<void>;
}

export async function startPostgres(): Promise<PostgresHandle> {
  const container: StartedPostgreSqlContainer = await new PostgreSqlContainer(
    'postgres:16-alpine',
  )
    .withStartupTimeout(120_000)
    .start();
  const client = postgres(container.getConnectionUri(), {
    max: 5,
    onnotice: () => undefined,
    connection: { TimeZone: 'UTC' },
  });
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });

  return {
    db,
    stop: async () => {
      await client.end({ timeout: 5 });
      await container.stop();
    },
  };
}

async function waitUntilReady(cache: RedisService): Promise<void> {
  const deadline = Date.now() + READY_TIMEOUT_MS;

  while (Date.now() < deadline) {
    if (await cache.ping()) return;
    await new Promise((resolve) => setTimeout(resolve, READY_POLL_MS));
  }

  throw new Error(`valkey did not become ready within ${READY_TIMEOUT_MS} ms`);
}

export async function startValkey(): Promise<ValkeyHandle> {
  const container: StartedTestContainer = await new GenericContainer(
    VALKEY_IMAGE,
  )
    .withExposedPorts(VALKEY_PORT)
    .start();
  const url = `redis://${container.getHost()}:${container.getMappedPort(VALKEY_PORT)}`;
  Object.assign(env, { REDIS_ENABLED: true, REDIS_URL: url });
  const cache = new RedisService(new ConfigService());
  await waitUntilReady(cache);

  return {
    cache,
    flush: async () => {
      await cache.delByPattern('*');
    },
    stop: async () => {
      await cache.onModuleDestroy();
      await container.stop();
    },
  };
}

export async function createApplication(
  db: TestDatabase,
  cache: CacheProvider,
): Promise<ApplicationHandle> {
  const moduleRef: TestingModule = await Test.createTestingModule({
    imports: [
      JwtModule.register({ global: true, secret: 'freshness-test-secret' }),
      DatabaseModule,
      RedisModule,
      DateModule,
      WorkspaceModule,
      AccountModule,
      CategoryModule,
      TransactionModule,
      ReportModule,
      BudgetModule,
      CardCycleModule,
      GoalModule,
      DashboardModule,
    ],
  })
    .overrideProvider(DRIZZLE_TOKEN)
    .useValue(db)
    .overrideProvider(CacheProvider)
    .useValue(cache)
    .overrideProvider(RedisService)
    .useValue(cache)
    .compile();

  return {
    get: <T>(token: { prototype: T }) =>
      moduleRef.get<T, T>(token as unknown as Type<T>, { strict: false }),
    close: () => moduleRef.close(),
  };
}
