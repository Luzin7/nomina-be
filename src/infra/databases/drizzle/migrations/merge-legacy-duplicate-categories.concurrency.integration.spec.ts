import { DEFAULT_CATEGORIES } from '@modules/category/constants/default-categories';
import {
  PostgreSqlContainer,
  StartedPostgreSqlContainer,
} from '@testcontainers/postgresql';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { randomUUID } from 'node:crypto';
import {
  cpSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import postgres from 'postgres';

const MIGRATIONS_FOLDER = resolve(__dirname, '../../../../../drizzle');
const MERGE_TAG = '0024_merge_legacy_duplicate_categories';

jest.setTimeout(240_000);

type Sql = postgres.Sql;

interface Workspace {
  workspaceId: string;
  accountId: string;
}

interface MergeRule {
  legacy: string;
  legacyParent: string | null;
  type: 'EXPENSE' | 'INCOME';
  target: string;
  targetParent: string | null;
}

const FOOD = 'Alimentação';
const LEISURE = 'Lazer';
const EDUCATION = 'Educação';
const SERVICES = 'Serviços';
const HEALTH = 'Saúde';
const HOUSING = 'Moradia';
const SHOPPING = 'Compras';
const FREELA = 'Freela/Projeto';
const LEGACY_RESTAURANTS = 'Restaurantes';
const LEGACY_ENERGY = 'Energia';
const SEED_RESTAURANT = 'Restaurante';
const SEED_LIGHT = 'Luz';
const LEGACY_CLOTHING = 'Vestuário';
const CLOTHING_CHILDREN = ['Roupas', 'Acessórios', 'Calçados'] as const;
const FREELANCE_CHILD = 'Freelance Web';
const SYSTEM_CATEGORY_NAME = 'Energia';

const MERGE_RULES: readonly MergeRule[] = [
  {
    legacy: LEGACY_RESTAURANTS,
    legacyParent: FOOD,
    type: 'EXPENSE',
    target: SEED_RESTAURANT,
    targetParent: FOOD,
  },
  {
    legacy: 'Streaming',
    legacyParent: LEISURE,
    type: 'EXPENSE',
    target: 'Assinatura (streaming, academia)',
    targetParent: LEISURE,
  },
  {
    legacy: 'Mensalidade',
    legacyParent: EDUCATION,
    type: 'EXPENSE',
    target: 'Curso/Mensalidade',
    targetParent: EDUCATION,
  },
  {
    legacy: 'Cursos',
    legacyParent: EDUCATION,
    type: 'EXPENSE',
    target: 'Curso/Mensalidade',
    targetParent: EDUCATION,
  },
  {
    legacy: 'Assinaturas',
    legacyParent: SERVICES,
    type: 'EXPENSE',
    target: 'Assinatura (software)',
    targetParent: SERVICES,
  },
  {
    legacy: 'Medicamentos',
    legacyParent: HEALTH,
    type: 'EXPENSE',
    target: 'Farmácia',
    targetParent: HEALTH,
  },
  {
    legacy: LEGACY_ENERGY,
    legacyParent: HOUSING,
    type: 'EXPENSE',
    target: SEED_LIGHT,
    targetParent: HOUSING,
  },
  {
    legacy: 'Materiais',
    legacyParent: EDUCATION,
    type: 'EXPENSE',
    target: 'Material',
    targetParent: EDUCATION,
  },
  {
    legacy: 'Freelance',
    legacyParent: null,
    type: 'INCOME',
    target: FREELA,
    targetParent: null,
  },
];

const PRODUCTION_FK_DRIFT = `
  ALTER TABLE categories DROP CONSTRAINT categories_parent_id_categories_id_fk;
  ALTER TABLE categories ADD CONSTRAINT categories_parent_id_fkey FOREIGN KEY (parent_id) REFERENCES categories(id) ON DELETE SET NULL;
  ALTER TABLE transactions DROP CONSTRAINT transactions_category_id_categories_id_fk;
  ALTER TABLE transactions ADD CONSTRAINT transactions_category_id_fkey FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE RESTRICT;
  ALTER TABLE recurring_transactions DROP CONSTRAINT recurring_transactions_category_id_categories_id_fk;
`;

function path(name: string, parent: string | null): string {
  return parent ? `${parent}>${name}` : name;
}

describe('0024 merge legacy duplicate categories', () => {
  let container: StartedPostgreSqlContainer;
  let admin: Sql;
  let preMergeFolder: string;
  const openClients: Sql[] = [];
  const noticesByClient = new Map<Sql, string[]>();

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:17-alpine')
      .withStartupTimeout(120_000)
      .start();
    admin = postgres(container.getConnectionUri(), {
      max: 1,
      onnotice: () => undefined,
    });
    preMergeFolder = buildPreMergeFolder();
  });

  afterAll(async () => {
    await Promise.all(openClients.map((client) => client.end({ timeout: 5 })));
    await admin.end({ timeout: 5 });
    await container.stop();
    rmSync(preMergeFolder, { recursive: true, force: true });
  });

  function buildPreMergeFolder(): string {
    const folder = mkdtempSync(join(tmpdir(), 'drizzle-pre-0024-'));
    cpSync(MIGRATIONS_FOLDER, folder, { recursive: true });
    rmSync(join(folder, `${MERGE_TAG}.sql`));
    rmSync(join(folder, 'meta', '0024_snapshot.json'));
    const journalPath = join(folder, 'meta', '_journal.json');
    const journal = JSON.parse(readFileSync(journalPath, 'utf8'));
    journal.entries = journal.entries.filter(
      (entry: { tag: string }) => entry.tag !== MERGE_TAG,
    );
    writeFileSync(journalPath, JSON.stringify(journal));
    return folder;
  }

  async function createDatabaseMigratedTo0023(drift: boolean): Promise<Sql> {
    const name = `db_${randomUUID().replace(/-/g, '')}`;
    await admin.unsafe(`CREATE DATABASE ${name}`);
    const uri = new URL(container.getConnectionUri());
    uri.pathname = `/${name}`;
    const messages: string[] = [];
    const client = postgres(uri.toString(), {
      max: 1,
      onnotice: (notice) => messages.push(notice.message),
    });
    noticesByClient.set(client, messages);
    openClients.push(client);
    await migrate(drizzle(client), { migrationsFolder: preMergeFolder });
    if (drift) await client.unsafe(PRODUCTION_FK_DRIFT);
    return client;
  }

  async function failureOf(operation: Promise<unknown>): Promise<string> {
    const error = await operation.then(
      () => undefined,
      (caught: Error & { cause?: Error }) => caught,
    );
    return `${error?.message} ${error?.cause?.message}`;
  }

  function migrateToLatest(client: Sql) {
    return migrate(drizzle(client), { migrationsFolder: MIGRATIONS_FOLDER });
  }

  async function createWorkspace(client: Sql): Promise<Workspace> {
    const workspaceId = randomUUID();
    const accountId = randomUUID();
    await client`INSERT INTO workspaces (id, name) VALUES (${workspaceId}, 'ws')`;
    await client`INSERT INTO accounts (id, workspace_id, name, type) VALUES (${accountId}, ${workspaceId}, 'acc', 'CHECKING')`;
    return { workspaceId, accountId };
  }

  async function insertCategory(
    client: Sql,
    workspaceId: string,
    name: string,
    type: string,
    parentId: string | null,
  ): Promise<string> {
    const id = randomUUID();
    await client`INSERT INTO categories (id, workspace_id, name, type, is_system_category, parent_id) VALUES (${id}, ${workspaceId}, ${name}, ${type}, false, ${parentId})`;
    return id;
  }

  async function seedDefaultTree(
    client: Sql,
    workspaceId: string,
  ): Promise<Map<string, string>> {
    const ids = new Map<string, string>();
    for (const node of DEFAULT_CATEGORIES) {
      const parentId = await insertCategory(
        client,
        workspaceId,
        node.name,
        node.type,
        null,
      );
      ids.set(node.name, parentId);
      for (const child of node.children ?? []) {
        ids.set(
          path(child, node.name),
          await insertCategory(client, workspaceId, child, node.type, parentId),
        );
      }
    }
    return ids;
  }

  async function addTransaction(
    client: Sql,
    ws: Workspace,
    categoryId: string,
    title: string,
  ) {
    await client`INSERT INTO transactions (id, workspace_id, account_id, category_id, title, amount, date, type, status) VALUES (${randomUUID()}, ${ws.workspaceId}, ${ws.accountId}, ${categoryId}, ${title}, 100, now(), 'EXPENSE', 'COMPLETED')`;
    await client`INSERT INTO recurring_transactions (id, workspace_id, account_id, category_id, type, title, amount, frequency, start_date) VALUES (${randomUUID()}, ${ws.workspaceId}, ${ws.accountId}, ${categoryId}, 'EXPENSE', ${title}, 100, 'MONTHLY', now())`;
  }

  async function insertLegacy(
    client: Sql,
    ws: Workspace,
    name: string,
    type: string,
    parentId: string | null,
  ): Promise<string> {
    const id = await insertCategory(
      client,
      ws.workspaceId,
      name,
      type,
      parentId,
    );
    await addTransaction(client, ws, id, `legacy:${name}`);
    return id;
  }

  async function seedFullLegacyWorkspace(client: Sql): Promise<Workspace> {
    const ws = await createWorkspace(client);
    const tree = await seedDefaultTree(client, ws.workspaceId);
    for (const rule of MERGE_RULES) {
      const parentId = rule.legacyParent ? tree.get(rule.legacyParent)! : null;
      const legacyId = await insertLegacy(
        client,
        ws,
        rule.legacy,
        rule.type,
        parentId,
      );
      if (rule.legacy === 'Freelance') {
        await insertLegacy(client, ws, FREELANCE_CHILD, 'INCOME', legacyId);
      }
    }
    const clothingId = await insertLegacy(
      client,
      ws,
      LEGACY_CLOTHING,
      'EXPENSE',
      null,
    );
    for (const child of CLOTHING_CHILDREN) {
      await insertLegacy(client, ws, child, 'EXPENSE', clothingId);
    }
    return ws;
  }

  async function seedPartialLegacyWorkspace(client: Sql): Promise<Workspace> {
    const ws = await createWorkspace(client);
    const tree = await seedDefaultTree(client, ws.workspaceId);
    await insertLegacy(
      client,
      ws,
      LEGACY_ENERGY,
      'EXPENSE',
      tree.get(HOUSING)!,
    );
    const clothingId = await insertCategory(
      client,
      ws.workspaceId,
      LEGACY_CLOTHING,
      'EXPENSE',
      null,
    );
    await insertLegacy(client, ws, 'Roupas', 'EXPENSE', clothingId);
    await insertCategory(
      client,
      ws.workspaceId,
      'Roupas',
      'EXPENSE',
      tree.get(SHOPPING)!,
    );
    return ws;
  }

  async function seedUntouchedWorkspace(client: Sql): Promise<Workspace> {
    const ws = await createWorkspace(client);
    const tree = await seedDefaultTree(client, ws.workspaceId);
    await addTransaction(
      client,
      ws,
      tree.get(path(SEED_RESTAURANT, FOOD))!,
      'seed:Restaurante',
    );
    return ws;
  }

  async function insertSystemCategory(client: Sql): Promise<string> {
    const id = randomUUID();
    await client`INSERT INTO categories (id, workspace_id, name, type, is_system_category, parent_id) VALUES (${id}, NULL, ${SYSTEM_CATEGORY_NAME}, 'EXPENSE', true, NULL)`;
    return id;
  }

  async function placementByTitle(
    client: Sql,
    workspaceId: string,
    table: string,
  ): Promise<Map<string, string>> {
    const rows = await client.unsafe(
      `SELECT t.title, c.name, p.name AS parent_name
       FROM ${table} t
       JOIN categories c ON c.id = t.category_id
       LEFT JOIN categories p ON p.id = c.parent_id
       WHERE t.workspace_id = $1`,
      [workspaceId],
    );
    return new Map<string, string>(
      rows.map((row) => [row.title, path(row.name, row.parent_name)]),
    );
  }

  function categorySnapshot(client: Sql, workspaceId: string) {
    return client`SELECT id, name, type, parent_id FROM categories WHERE workspace_id = ${workspaceId} ORDER BY id`;
  }

  function transactionSnapshot(client: Sql, workspaceId: string) {
    return client`SELECT id, category_id FROM transactions WHERE workspace_id = ${workspaceId} ORDER BY id`;
  }

  async function countRows(
    client: Sql,
    table: string,
    workspaceId: string,
  ): Promise<number> {
    const [row] = await client.unsafe(
      `SELECT count(*)::int AS total FROM ${table} WHERE workspace_id = $1`,
      [workspaceId],
    );
    return row.total;
  }

  async function countAppliedMigrations(client: Sql): Promise<number> {
    const [row] =
      await client`SELECT count(*)::int AS total FROM drizzle.__drizzle_migrations`;
    return row.total;
  }

  describe.each([
    ['repository foreign keys', false],
    ['production foreign key drift', true],
  ])('with %s', (_label, drift) => {
    let client: Sql;
    let full: Workspace;
    let partial: Workspace;
    let untouched: Workspace;
    let systemCategoryId: string;
    let counts: Record<string, number>;
    let untouchedCategoriesBefore: unknown;
    let untouchedTransactionsBefore: unknown;
    let fullPlacement: Record<string, Map<string, string>>;
    let partialPlacement: Record<string, Map<string, string>>;

    async function placements(ws: Workspace) {
      return {
        transactions: await placementByTitle(
          client,
          ws.workspaceId,
          'transactions',
        ),
        recurring_transactions: await placementByTitle(
          client,
          ws.workspaceId,
          'recurring_transactions',
        ),
      };
    }

    beforeAll(async () => {
      client = await createDatabaseMigratedTo0023(drift);
      full = await seedFullLegacyWorkspace(client);
      partial = await seedPartialLegacyWorkspace(client);
      untouched = await seedUntouchedWorkspace(client);
      systemCategoryId = await insertSystemCategory(client);
      counts = {
        full: await countRows(client, 'transactions', full.workspaceId),
        fullRecurring: await countRows(
          client,
          'recurring_transactions',
          full.workspaceId,
        ),
        partial: await countRows(client, 'transactions', partial.workspaceId),
      };
      untouchedCategoriesBefore = await categorySnapshot(
        client,
        untouched.workspaceId,
      );
      untouchedTransactionsBefore = await transactionSnapshot(
        client,
        untouched.workspaceId,
      );

      await migrateToLatest(client);

      fullPlacement = await placements(full);
      partialPlacement = await placements(partial);
    });

    describe.each(['transactions', 'recurring_transactions'] as const)(
      '%s',
      (table) => {
        it.each(MERGE_RULES)('$legacy', (rule) => {
          expect(fullPlacement[table].get(`legacy:${rule.legacy}`)).toBe(
            path(rule.target, rule.targetParent),
          );
        });

        it('moves the Freelance child under the target', () => {
          expect(fullPlacement[table].get(`legacy:${FREELANCE_CHILD}`)).toBe(
            path(FREELANCE_CHILD, FREELA),
          );
        });

        it('moves the root Vestuário refs to Compras > Vestuário', () => {
          expect(fullPlacement[table].get(`legacy:${LEGACY_CLOTHING}`)).toBe(
            path(LEGACY_CLOTHING, SHOPPING),
          );
        });

        it.each(CLOTHING_CHILDREN)(
          'moves Vestuário child %s under Compras',
          (child) => {
            expect(fullPlacement[table].get(`legacy:${child}`)).toBe(
              path(child, SHOPPING),
            );
          },
        );

        it('moves partial workspace Energia to Luz', () => {
          expect(partialPlacement[table].get(`legacy:${LEGACY_ENERGY}`)).toBe(
            path(SEED_LIGHT, HOUSING),
          );
        });

        it('merges partial workspace Roupas into the existing Compras child', () => {
          expect(partialPlacement[table].get('legacy:Roupas')).toBe(
            path('Roupas', SHOPPING),
          );
        });
      },
    );

    it('removes every legacy row', async () => {
      const rows = await client`
        SELECT c.id FROM categories c
        WHERE c.workspace_id IS NOT NULL
          AND (c.name = ANY(${MERGE_RULES.map((rule) => rule.legacy)})
            OR (c.name = ${LEGACY_CLOTHING} AND c.parent_id IS NULL))`;
      expect(rows).toHaveLength(0);
    });

    it('leaves a single Roupas in the partial workspace', async () => {
      const rows =
        await client`SELECT id FROM categories WHERE workspace_id = ${partial.workspaceId} AND name = 'Roupas'`;
      expect(rows).toHaveLength(1);
    });

    it('leaves no grandchildren', async () => {
      const rows = await client`
        SELECT c.id FROM categories c
        JOIN categories p ON p.id = c.parent_id
        WHERE c.workspace_id IS NOT NULL AND p.parent_id IS NOT NULL`;
      expect(rows).toHaveLength(0);
    });

    it('keeps the transaction count of the full workspace', async () => {
      expect(await countRows(client, 'transactions', full.workspaceId)).toBe(
        counts.full,
      );
    });

    it('keeps the recurring count of the full workspace', async () => {
      expect(
        await countRows(client, 'recurring_transactions', full.workspaceId),
      ).toBe(counts.fullRecurring);
    });

    it('keeps the transaction count of the partial workspace', async () => {
      expect(await countRows(client, 'transactions', partial.workspaceId)).toBe(
        counts.partial,
      );
    });

    it('leaves the untouched workspace categories identical', async () => {
      expect(await categorySnapshot(client, untouched.workspaceId)).toEqual(
        untouchedCategoriesBefore,
      );
    });

    it('leaves the untouched workspace transactions identical', async () => {
      expect(await transactionSnapshot(client, untouched.workspaceId)).toEqual(
        untouchedTransactionsBefore,
      );
    });

    it('reports non-zero totals in the merge notice', () => {
      const notice = noticesByClient
        .get(client)!
        .find((message) => message.startsWith('0024 merge:'));
      expect(notice).toMatch(
        /deleted=[1-9]\d*, tx=[1-9]\d*, recurring=[1-9]\d*, children_moved=[1-9]\d*, children_merged=[1-9]\d*/,
      );
    });

    it('leaves the system category untouched', async () => {
      const rows =
        await client`SELECT name, workspace_id, is_system_category FROM categories WHERE id = ${systemCategoryId}`;
      expect(rows).toEqual([
        {
          name: SYSTEM_CATEGORY_NAME,
          workspace_id: null,
          is_system_category: true,
        },
      ]);
    });
  });

  describe('when a later rule has no target', () => {
    let client: Sql;
    let ws: Workspace;
    let restaurantsId: string;
    let appliedBefore: number;
    let failure: string;

    beforeAll(async () => {
      client = await createDatabaseMigratedTo0023(false);
      ws = await createWorkspace(client);
      const tree = await seedDefaultTree(client, ws.workspaceId);
      restaurantsId = await insertLegacy(
        client,
        ws,
        LEGACY_RESTAURANTS,
        'EXPENSE',
        tree.get(FOOD)!,
      );
      await insertLegacy(
        client,
        ws,
        LEGACY_ENERGY,
        'EXPENSE',
        tree.get(HOUSING)!,
      );
      await client`DELETE FROM categories WHERE id = ${tree.get(path(SEED_LIGHT, HOUSING))!}`;
      appliedBefore = await countAppliedMigrations(client);
      failure = await failureOf(migrateToLatest(client));
    });

    it('fails the migration', () => {
      expect(failure).toMatch(/missing target Luz/);
    });

    it('keeps the earlier merged legacy row', async () => {
      const rows =
        await client`SELECT id FROM categories WHERE id = ${restaurantsId}`;
      expect(rows).toHaveLength(1);
    });

    it('keeps the earlier transaction on the legacy row', async () => {
      const rows =
        await client`SELECT id FROM transactions WHERE category_id = ${restaurantsId}`;
      expect(rows).toHaveLength(1);
    });

    it('records no 0024 migration', async () => {
      expect(await countAppliedMigrations(client)).toBe(appliedBefore);
    });
  });

  describe('when the only target is in another workspace', () => {
    let client: Sql;
    let legacyId: string;
    let failure: string;

    beforeAll(async () => {
      client = await createDatabaseMigratedTo0023(false);
      const origin = await createWorkspace(client);
      const originTree = await seedDefaultTree(client, origin.workspaceId);
      const other = await createWorkspace(client);
      await seedDefaultTree(client, other.workspaceId);
      legacyId = await insertLegacy(
        client,
        origin,
        LEGACY_RESTAURANTS,
        'EXPENSE',
        originTree.get(FOOD)!,
      );
      await client`DELETE FROM categories WHERE id = ${originTree.get(path(SEED_RESTAURANT, FOOD))!}`;
      failure = await failureOf(migrateToLatest(client));
    });

    it('fails the migration', () => {
      expect(failure).toMatch(/missing target Restaurante/);
    });

    it('keeps the legacy row', async () => {
      const rows =
        await client`SELECT id FROM categories WHERE id = ${legacyId}`;
      expect(rows).toHaveLength(1);
    });
  });

  describe('on a database without legacy rows', () => {
    it('changes nothing', async () => {
      const client = await createDatabaseMigratedTo0023(false);
      const ws = await seedUntouchedWorkspace(client);
      const before = await categorySnapshot(client, ws.workspaceId);

      await migrateToLatest(client);

      expect(await categorySnapshot(client, ws.workspaceId)).toEqual(before);
    });
  });
});
