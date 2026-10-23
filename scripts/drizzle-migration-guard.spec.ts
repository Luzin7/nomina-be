import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  DrizzleJournal,
  parseMigrationTagIndex,
} from './rename-drizzle-migration';

const DRIZZLE_DIRECTORY = join(__dirname, '..', 'drizzle');

type ColumnSnapshot = {
  notNull: boolean;
};

type TableSnapshot = {
  columns: Record<string, ColumnSnapshot>;
};

type SchemaSnapshot = {
  tables: Record<string, TableSnapshot>;
};

function readJournal(): DrizzleJournal {
  const raw = readFileSync(
    join(DRIZZLE_DIRECTORY, 'meta', '_journal.json'),
    'utf8',
  );

  return JSON.parse(raw) as DrizzleJournal;
}

function readLatestSnapshot(journal: DrizzleJournal): SchemaSnapshot {
  const latestEntry = journal.entries.at(-1);

  if (!latestEntry) throw new Error('journal has no entries');

  const prefix = String(parseMigrationTagIndex(latestEntry.tag)).padStart(
    4,
    '0',
  );

  return JSON.parse(
    readFileSync(
      join(DRIZZLE_DIRECTORY, 'meta', `${prefix}_snapshot.json`),
      'utf8',
    ),
  ) as SchemaSnapshot;
}

function findStaleWhenEntries(journal: DrizzleJournal): string[] {
  const entriesByIndex = [...journal.entries].sort((a, b) => a.idx - b.idx);

  return entriesByIndex
    .filter(
      (entry, position) =>
        position > 0 && entriesByIndex[position - 1].when >= entry.when,
    )
    .map((entry) => `${entry.tag} (when=${entry.when})`);
}

describe('drizzle migration order', () => {
  it('never lets a later entry carry an earlier or equal when', () => {
    expect(findStaleWhenEntries(readJournal())).toEqual([]);
  });

  it('declares recurring_transactions.category_id nullable in the latest snapshot', () => {
    const snapshot = readLatestSnapshot(readJournal());
    const column =
      snapshot.tables['public.recurring_transactions'].columns.category_id;

    expect(column.notNull).toBe(false);
  });
});
