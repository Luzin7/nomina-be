import postgres from 'postgres';
import {
  buildRunReport,
  runDefaultCategoryBackfill,
} from './backfill-default-categories';

const DEFAULT_CATEGORY_NODES = 38;

type QueryHandler = (query: string) => unknown;

function fakeSql(handle: QueryHandler): postgres.Sql {
  const query = (strings: TemplateStringsArray) =>
    Promise.resolve().then(() => handle(strings.join(' ')));

  const connection = Object.assign(query, {
    release: () => undefined,
  });

  return Object.assign(connection, {
    reserve: () => Promise.resolve(connection),
  }) as unknown as postgres.Sql;
}

function uniqueViolation(constraint: string): Error {
  return Object.assign(
    new Error(`duplicate key value violates unique constraint "${constraint}"`),
    { code: '23505', constraint },
  );
}

function duplicateKeyError(): Error {
  return uniqueViolation('unq_cat_ws_name_type_parent');
}

describe('default category backfill', () => {
  it('takes the session advisory lock before reading workspaces and releases it', async () => {
    const queries: string[] = [];
    const sql = fakeSql((query) => {
      queries.push(query);
      if (query.includes('FROM workspaces')) return [{ id: 'ws-1' }];
      return [{ id: 'cat-1' }];
    });

    await runDefaultCategoryBackfill(sql, 'apply');

    const lockIndex = queries.findIndex((query) =>
      query.includes('pg_advisory_lock'),
    );
    const batchIndex = queries.findIndex((query) =>
      query.includes('FROM workspaces'),
    );

    expect(queries[0]).toContain("set_config('lock_timeout'");
    expect(lockIndex).toBeGreaterThan(0);
    expect(lockIndex).toBeLessThan(batchIndex);
    expect(queries.join('\n')).toContain('pg_advisory_unlock');
  });

  it('opens one transaction per workspace batch', async () => {
    const transactions: number[] = [];
    let reads = 0;
    const sql = fakeSql((query) => {
      if (query === 'BEGIN') {
        transactions.push(reads);
        return [];
      }

      if (!query.includes('FROM workspaces')) return [{ id: 'cat-1' }];
      reads += 1;
      if (reads === 1) {
        return Array.from({ length: 200 }, (_, index) => ({
          id: `ws-${index}`,
        }));
      }

      return [{ id: 'ws-200' }];
    });

    const summary = await runDefaultCategoryBackfill(sql, 'apply');

    expect(summary.workspaces).toBe(201);
    expect(transactions).toEqual([1, 2]);
  });

  it('releases the session advisory lock when a batch fails', async () => {
    const queries: string[] = [];
    const sql = fakeSql((query) => {
      queries.push(query);
      if (query.includes('FROM workspaces')) return [{ id: 'ws-1' }];
      if (query.includes('INSERT INTO categories')) throw new Error('boom');
      return [{ id: 'cat-1' }];
    });

    await expect(runDefaultCategoryBackfill(sql, 'apply')).rejects.toThrow(
      'boom',
    );

    expect(queries.join('\n')).toContain('pg_advisory_unlock');
  });

  it('counts a concurrent duplicate insert as skipped', async () => {
    const sql = fakeSql((query) => {
      if (query.includes('FROM workspaces')) return [{ id: 'ws-1' }];
      if (query.includes('INSERT INTO categories')) throw duplicateKeyError();
      return [{ id: 'cat-1' }];
    });

    const summary = await runDefaultCategoryBackfill(sql, 'apply');

    expect(buildRunReport('apply', summary)).toEqual({
      mode: 'apply',
      workspaces: 1,
      inserted: 0,
      skipped: DEFAULT_CATEGORY_NODES,
    });
  });

  it('aborts on an insert error that is not a unique violation', async () => {
    const sql = fakeSql((query) => {
      if (query.includes('FROM workspaces')) return [{ id: 'ws-1' }];
      if (query.includes('INSERT INTO categories')) throw new Error('boom');
      return [{ id: 'cat-1' }];
    });

    await expect(runDefaultCategoryBackfill(sql, 'apply')).rejects.toThrow(
      'boom',
    );
  });

  it('aborts on a unique violation from another table', async () => {
    const sql = fakeSql((query) => {
      if (query.includes('FROM workspaces')) return [{ id: 'ws-1' }];
      if (query.includes('INSERT INTO categories')) {
        throw uniqueViolation('unq_other_ws_name');
      }
      return [{ id: 'cat-1' }];
    });

    await expect(runDefaultCategoryBackfill(sql, 'apply')).rejects.toThrow(
      'unq_other_ws_name',
    );
  });
});
