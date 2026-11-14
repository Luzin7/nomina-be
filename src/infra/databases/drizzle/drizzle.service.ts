import { Inject, Injectable } from '@nestjs/common';
import {
  PostgresJsDatabase,
  PostgresJsQueryResultHKT,
} from 'drizzle-orm/postgres-js';
import { PgDatabase } from 'drizzle-orm/pg-core';
import { AsyncLocalStorage } from 'node:async_hooks';
import { DRIZZLE_TOKEN } from './drizzle.provider';
import * as schema from './schema';

type DrizzleExecutor = PgDatabase<PostgresJsQueryResultHKT, typeof schema>;

@Injectable()
export class DrizzleService {
  private readonly transactionContext =
    new AsyncLocalStorage<DrizzleExecutor>();

  constructor(
    @Inject(DRIZZLE_TOKEN)
    private readonly pool: PostgresJsDatabase<typeof schema>,
  ) {}

  get db(): DrizzleExecutor {
    return this.transactionContext.getStore() ?? this.pool;
  }

  runWithin<Result>(
    transaction: DrizzleExecutor,
    work: () => Promise<Result>,
  ): Promise<Result> {
    return this.transactionContext.run(transaction, work);
  }
}
