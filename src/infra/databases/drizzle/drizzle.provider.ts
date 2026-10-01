import { env } from '@infra/env';
import { Injectable, Logger, OnModuleDestroy, Provider } from '@nestjs/common';
import { PostgresJsDatabase, drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

export const DRIZZLE_TOKEN = Symbol('DRIZZLE_CONNECTION');

@Injectable()
export class DrizzleProvider implements OnModuleDestroy {
  private readonly logger = new Logger(DrizzleProvider.name);
  private readonly queryClient: postgres.Sql;
  readonly db: PostgresJsDatabase<typeof schema>;

  constructor() {
    const connectionString = env.DATABASE_URL;
    if (!connectionString) {
      throw new Error('DATABASE_URL is missing for Drizzle initialization');
    }

    this.queryClient = postgres(connectionString, {
      max: 10,
      idle_timeout: 25,
      connect_timeout: 10,
      ssl: env.NODE_ENV === 'production' ? 'require' : false,
      debug: (_, query, params) => this.onQuery(String(query), params),
    });

    this.db = drizzle(this.queryClient, { schema, logger: false });
  }

  async onModuleDestroy(): Promise<void> {
    this.logger.log('Closing PostgreSQL connection pool…');
    await this.queryClient.end({ timeout: 5 });
    this.logger.log('PostgreSQL connection pool closed.');
  }

  private onQuery(query: string, params: unknown[]): void {
    if (env.NODE_ENV === 'dev') {
      const preview = query.length > 200 ? `${query.slice(0, 200)}…` : query;
      this.logger.debug(
        `query: ${preview} | params: ${JSON.stringify(params)}`,
      );
    }
  }
}

export const DrizzleTokenProvider: Provider = {
  provide: DRIZZLE_TOKEN,
  useFactory: (provider: DrizzleProvider) => provider.db,
  inject: [DrizzleProvider],
};
