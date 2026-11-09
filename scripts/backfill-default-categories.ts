import { config } from 'dotenv';
import { randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { DEFAULT_CATEGORIES } from '../src/modules/category/constants/default-categories';
import { initAlerting, reportFatalFailure } from './backfill-balance-movements';

config({ path: '.env' });

const WORKSPACE_BATCH_SIZE = 200;

const CATEGORY_BACKFILL_LOCK_KEY = 728_100_001;

const CATEGORY_BACKFILL_LOCK_TIMEOUT = '10s';

const CATEGORY_UNIQUE_CONSTRAINTS = new Set([
  'unq_cat_ws_name_type_parent',
  'unq_cat_sys_name_type_parent',
]);

type RunMode = 'dry-run' | 'apply';

export type CategoryBackfillCounts = {
  inserted: number;
  skipped: number;
};

export type CategoryBackfillSummary = CategoryBackfillCounts & {
  workspaces: number;
};

type ExistingCategory = {
  id: string;
  name: string;
  type: string;
  parentId: string | null;
};

type MissingCategory = {
  name: string;
  type: string;
  parentName: string | null;
};

class MissingDatabaseUrlError extends Error {
  constructor() {
    super('DATABASE_URL não está definida nas variáveis de ambiente');
    this.name = 'MissingDatabaseUrlError';
  }
}

class UnknownArgumentError extends Error {
  constructor(argument: string) {
    super(`Argumento não reconhecido: ${argument}`);
    this.name = 'UnknownArgumentError';
  }
}

class ConflictingModeError extends Error {
  constructor() {
    super('Use apenas um entre --dry-run e --apply');
    this.name = 'ConflictingModeError';
  }
}

class CategoryLookupError extends Error {
  constructor(name: string, type: string, workspaceId: string) {
    super(
      `Categoria ${name} (${type}) não encontrada no workspace ${workspaceId} após a inserção`,
    );
    this.name = 'CategoryLookupError';
  }
}

export function parseMode(argv: string[]): RunMode {
  const unknown = argv.find(
    (argument) => argument !== '--apply' && argument !== '--dry-run',
  );
  if (unknown) throw new UnknownArgumentError(unknown);
  if (argv.includes('--apply') && argv.includes('--dry-run')) {
    throw new ConflictingModeError();
  }

  return argv.includes('--apply') ? 'apply' : 'dry-run';
}

function resolveDatabaseUrl(): string {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new MissingDatabaseUrlError();

  return databaseUrl;
}

function identity(name: string, type: string, parentId: string | null): string {
  return `${type}:${name}:${parentId ?? 'root'}`;
}

async function readWorkspaceBatch(
  sql: postgres.ISql,
  afterId: string | null,
): Promise<string[]> {
  const rows = afterId
    ? await sql<{ id: string }[]>`
        SELECT id FROM workspaces
        WHERE id > ${afterId}
        ORDER BY id
        LIMIT ${WORKSPACE_BATCH_SIZE}
      `
    : await sql<{ id: string }[]>`
        SELECT id FROM workspaces
        ORDER BY id
        LIMIT ${WORKSPACE_BATCH_SIZE}
      `;

  return rows.map((row) => row.id);
}

async function readExistingCategories(
  sql: postgres.ISql,
  workspaceId: string,
): Promise<ExistingCategory[]> {
  const rows = await sql<ExistingCategory[]>`
    SELECT id, name, type, parent_id AS "parentId"
    FROM categories
    WHERE workspace_id = ${workspaceId}
  `;

  return rows;
}

function planMissingCategories(
  existing: ExistingCategory[],
): MissingCategory[] {
  const byIdentity = new Map(
    existing.map((category) => [
      identity(category.name, category.type, category.parentId),
      category,
    ]),
  );

  return DEFAULT_CATEGORIES.flatMap((node) => {
    const parent = byIdentity.get(identity(node.name, node.type, null));
    const missingParent = parent
      ? []
      : [{ name: node.name, type: node.type, parentName: null }];

    const missingChildren = (node.children ?? []).flatMap((childName) =>
      byIdentity.has(identity(childName, node.type, parent?.id ?? null))
        ? []
        : [{ name: childName, type: node.type, parentName: node.name }],
    );

    return [...missingParent, ...missingChildren];
  });
}

function isUniqueViolation(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;

  const { code, constraint } = error as {
    code?: string;
    constraint?: string;
  };

  return (
    code === '23505' &&
    constraint !== undefined &&
    CATEGORY_UNIQUE_CONSTRAINTS.has(constraint)
  );
}

async function insertCategoryIfMissing(
  sql: postgres.ISql,
  workspaceId: string,
  name: string,
  type: string,
  parentId: string | null,
): Promise<string | null> {
  try {
    const rows = await sql<{ id: string }[]>`
      INSERT INTO categories
        (id, workspace_id, name, type, parent_id, is_system_category)
      SELECT ${randomUUID()}, ${workspaceId}, ${name}, ${type}, ${parentId}, false
      WHERE NOT EXISTS (
        SELECT 1 FROM categories
        WHERE workspace_id = ${workspaceId}
          AND name = ${name}
          AND type = ${type}
          AND parent_id IS NOT DISTINCT FROM ${parentId}
      )
      RETURNING id
    `;

    return rows[0]?.id ?? null;
  } catch (error) {
    if (isUniqueViolation(error)) return null;
    throw error;
  }
}

async function ensureCategory(
  sql: postgres.ISql,
  workspaceId: string,
  name: string,
  type: string,
  parentId: string | null,
): Promise<{ id: string; inserted: boolean }> {
  const insertedId = await insertCategoryIfMissing(
    sql,
    workspaceId,
    name,
    type,
    parentId,
  );
  if (insertedId) return { id: insertedId, inserted: true };

  const [existing] = await sql<{ id: string }[]>`
    SELECT id FROM categories
    WHERE workspace_id = ${workspaceId}
      AND name = ${name}
      AND type = ${type}
      AND parent_id IS NOT DISTINCT FROM ${parentId}
    LIMIT 1
  `;
  if (!existing) throw new CategoryLookupError(name, type, workspaceId);

  return { id: existing.id, inserted: false };
}

async function applyWorkspace(
  sql: postgres.ISql,
  workspaceId: string,
): Promise<CategoryBackfillCounts> {
  const counts: CategoryBackfillCounts = { inserted: 0, skipped: 0 };

  for (const node of DEFAULT_CATEGORIES) {
    const parent = await ensureCategory(
      sql,
      workspaceId,
      node.name,
      node.type,
      null,
    );
    countOutcome(counts, parent.inserted);

    for (const childName of node.children ?? []) {
      const child = await ensureCategory(
        sql,
        workspaceId,
        childName,
        node.type,
        parent.id,
      );
      countOutcome(counts, child.inserted);
    }
  }

  return counts;
}

function countOutcome(counts: CategoryBackfillCounts, inserted: boolean): void {
  if (inserted) counts.inserted += 1;
  else counts.skipped += 1;
}

async function dryRunWorkspace(
  sql: postgres.ISql,
  workspaceId: string,
): Promise<CategoryBackfillCounts> {
  const missing = planMissingCategories(
    await readExistingCategories(sql, workspaceId),
  );

  return {
    inserted: missing.length,
    skipped: countDefaultNodes() - missing.length,
  };
}

function countDefaultNodes(): number {
  return DEFAULT_CATEGORIES.reduce(
    (total, node) => total + 1 + (node.children?.length ?? 0),
    0,
  );
}

type BatchHandler = (
  sql: postgres.Sql,
  workspaceIds: string[],
) => Promise<CategoryBackfillCounts>;

async function forEachWorkspace(
  sql: postgres.Sql,
  handler: BatchHandler,
): Promise<CategoryBackfillSummary> {
  const summary: CategoryBackfillSummary = {
    workspaces: 0,
    inserted: 0,
    skipped: 0,
  };

  let afterId: string | null = null;
  for (;;) {
    const workspaceIds = await readWorkspaceBatch(sql, afterId);
    if (workspaceIds.length === 0) break;

    const counts = await handler(sql, workspaceIds);
    summary.workspaces += workspaceIds.length;
    summary.inserted += counts.inserted;
    summary.skipped += counts.skipped;

    afterId = workspaceIds[workspaceIds.length - 1];
    if (workspaceIds.length < WORKSPACE_BATCH_SIZE) break;
  }

  return summary;
}

async function applyWorkspaceBatch(
  connection: postgres.Sql,
  workspaceIds: string[],
): Promise<CategoryBackfillCounts> {
  await connection`BEGIN`;

  try {
    const counts: CategoryBackfillCounts = { inserted: 0, skipped: 0 };

    for (const workspaceId of workspaceIds) {
      const workspaceCounts = await applyWorkspace(connection, workspaceId);
      counts.inserted += workspaceCounts.inserted;
      counts.skipped += workspaceCounts.skipped;
    }

    await connection`COMMIT`;
    return counts;
  } catch (error) {
    await connection`ROLLBACK`.catch(() => undefined);
    throw error;
  }
}

async function dryRunWorkspaceBatch(
  sql: postgres.Sql,
  workspaceIds: string[],
): Promise<CategoryBackfillCounts> {
  const counts: CategoryBackfillCounts = { inserted: 0, skipped: 0 };

  for (const workspaceId of workspaceIds) {
    const workspaceCounts = await dryRunWorkspace(sql, workspaceId);
    counts.inserted += workspaceCounts.inserted;
    counts.skipped += workspaceCounts.skipped;
  }

  return counts;
}

async function withBackfillLock<T>(
  sql: postgres.Sql,
  handler: (connection: postgres.Sql) => Promise<T>,
): Promise<T> {
  const connection = await sql.reserve();

  try {
    await connection`SELECT set_config('lock_timeout', ${CATEGORY_BACKFILL_LOCK_TIMEOUT}, false)`;
    try {
      await connection`SELECT pg_advisory_lock(${CATEGORY_BACKFILL_LOCK_KEY})`;
    } finally {
      await connection`SELECT set_config('lock_timeout', '0', false)`;
    }

    return await handler(connection);
  } finally {
    try {
      await connection`SELECT pg_advisory_unlock(${CATEGORY_BACKFILL_LOCK_KEY})`;
    } finally {
      connection.release();
    }
  }
}

export async function runDefaultCategoryBackfill(
  sql: postgres.Sql,
  mode: RunMode,
): Promise<CategoryBackfillSummary> {
  if (mode === 'dry-run') {
    return forEachWorkspace(sql, dryRunWorkspaceBatch);
  }

  return withBackfillLock(sql, (connection) =>
    forEachWorkspace(connection, applyWorkspaceBatch),
  );
}

export function buildRunReport(
  mode: RunMode,
  summary: CategoryBackfillSummary,
): CategoryBackfillSummary & { mode: RunMode } {
  return { mode, ...summary };
}

async function main(): Promise<void> {
  initAlerting();

  const mode = parseMode(process.argv.slice(2));
  const sql = postgres(resolveDatabaseUrl(), {
    max: 1,
    connect_timeout: 10,
    onnotice: () => undefined,
  });

  try {
    const summary = await runDefaultCategoryBackfill(sql, mode);
    console.log(JSON.stringify(buildRunReport(mode, summary)));
  } finally {
    await sql.end({ timeout: 5 });
  }
}

if (require.main === module) {
  main().catch(reportFatalFailure);
}
