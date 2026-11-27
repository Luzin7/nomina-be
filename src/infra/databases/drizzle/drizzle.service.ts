import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import {
  PostgresJsDatabase,
  PostgresJsQueryResultHKT,
} from 'drizzle-orm/postgres-js';
import { PgDatabase } from 'drizzle-orm/pg-core';
import { AsyncLocalStorage } from 'node:async_hooks';
import { DRIZZLE_TOKEN } from './drizzle.provider';
import * as schema from './schema';

export type DrizzleExecutor = PgDatabase<
  PostgresJsQueryResultHKT,
  typeof schema
>;

const READ_STATEMENT_TIMEOUT_MS = 1_000;
const SET_READ_TIMEOUT = sql.raw(
  `SET LOCAL statement_timeout = ${READ_STATEMENT_TIMEOUT_MS}`,
);
const READ_CURRENT_TIMEOUT = sql`SELECT current_setting('statement_timeout') AS "statementTimeout"`;

const readCurrentTimeout = async (
  executor: DrizzleExecutor,
): Promise<string> => {
  const [row] = await executor.execute<{ statementTimeout: string }>(
    READ_CURRENT_TIMEOUT,
  );

  return row.statementTimeout;
};

const restoreTimeout = (previous: string) =>
  sql`SELECT set_config('statement_timeout', ${previous}, true)`;

const runBounded = async <Result>(
  pool: PostgresJsDatabase<typeof schema>,
  work: (db: DrizzleExecutor) => Promise<Result>,
): Promise<Result> =>
  pool.transaction(async (transaction) => {
    await transaction.execute(SET_READ_TIMEOUT);

    return work(transaction);
  });

const runWithinEnclosing = async <Result>(
  executor: DrizzleExecutor,
  work: (db: DrizzleExecutor) => Promise<Result>,
): Promise<Result> =>
  executor.transaction(async (savepoint) => {
    const previous = await readCurrentTimeout(savepoint);

    await savepoint.execute(SET_READ_TIMEOUT);

    const result = await work(savepoint);

    await savepoint.execute(restoreTimeout(previous));

    return result;
  });

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

  withStatementTimeout<Result>(
    work: (db: DrizzleExecutor) => Promise<Result>,
  ): Promise<Result> {
    const enclosing = this.transactionContext.getStore();

    if (!enclosing) return runBounded(this.pool, work);

    return runWithinEnclosing(enclosing, work);
  }

  runWithin<Result>(
    transaction: DrizzleExecutor,
    work: () => Promise<Result>,
  ): Promise<Result> {
    return this.transactionContext.run(transaction, work);
  }
}
