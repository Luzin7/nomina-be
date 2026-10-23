import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  DrizzleJournal,
  DrizzleJournalEntry,
  EmptyJournalError,
  InvalidMigrationTagError,
  MigrationNumberingConflictError,
  buildMigrationRenamePlan,
  parseMigrationTagIndex,
  renameDrizzleMigration,
  serialiseJournal,
} from './rename-drizzle-migration';

const DRIZZLE_DIRECTORY = join(__dirname, '..', 'drizzle');

function buildEntry(
  overrides: Partial<DrizzleJournalEntry> = {},
): DrizzleJournalEntry {
  return {
    idx: 0,
    version: '7',
    when: 1772589605785,
    tag: '0000_initial',
    breakpoints: true,
    ...overrides,
  };
}

function buildJournal(entries: DrizzleJournalEntry[]): DrizzleJournal {
  return { version: '7', dialect: 'postgresql', entries };
}

function readJournal(drizzleDirectory: string): DrizzleJournal {
  return JSON.parse(
    readFileSync(join(drizzleDirectory, 'meta', '_journal.json'), 'utf8'),
  ) as DrizzleJournal;
}

function createScratchMigration(
  drizzleDirectory: string,
  tag: string,
): DrizzleJournal {
  const metaDirectory = join(drizzleDirectory, 'meta');
  mkdirSync(metaDirectory, { recursive: true });

  const journal = buildJournal([
    buildEntry({ idx: 0, tag: '0000_initial' }),
    buildEntry({ idx: 1, tag: '0016_add_auth_sessions' }),
    buildEntry({ idx: 5, tag: '0020_balance_movements' }),
    buildEntry({ idx: 6, tag }),
  ]);
  writeFileSync(
    join(metaDirectory, '_journal.json'),
    serialiseJournal(journal),
  );
  writeFileSync(join(drizzleDirectory, `0000_initial.sql`), 'select 1;');
  writeFileSync(
    join(metaDirectory, '0000_snapshot.json'),
    JSON.stringify({ id: 'initial' }),
  );
  writeFileSync(join(drizzleDirectory, `${tag}.sql`), 'select 2;');
  writeFileSync(
    join(metaDirectory, `0006_snapshot.json`),
    JSON.stringify({ id: 'scratch' }),
  );

  return journal;
}

describe('buildMigrationRenamePlan', () => {
  it('targets the next number after the highest existing tag', () => {
    const journal = buildJournal([
      buildEntry({ idx: 0, tag: '0000_initial' }),
      buildEntry({ idx: 1, tag: '0016_add_auth_sessions' }),
      buildEntry({ idx: 5, tag: '0020_balance_movements' }),
      buildEntry({ idx: 6, tag: '0006_quiet_bloodstorm' }),
    ]);

    expect(buildMigrationRenamePlan(journal)).toEqual({
      kind: 'rename',
      sourceTag: '0006_quiet_bloodstorm',
      sourceIndex: 6,
      sourceEntryIndex: 6,
      targetIndex: 21,
      targetTag: '0021_quiet_bloodstorm',
    });
  });

  it('keeps the newest entry untouched when its number is already next', () => {
    const journal = buildJournal([
      buildEntry({ idx: 0, tag: '0000_initial' }),
      buildEntry({ idx: 4, tag: '0019_unique_recurring_date' }),
      buildEntry({ idx: 5, tag: '0020_balance_movements' }),
    ]);

    expect(buildMigrationRenamePlan(journal)).toMatchObject({
      kind: 'unchanged',
      sourceTag: '0020_balance_movements',
      targetIndex: 20,
      targetTag: '0020_balance_movements',
    });
  });

  it('fails on an empty journal', () => {
    expect(() => buildMigrationRenamePlan(buildJournal([]))).toThrow(
      EmptyJournalError,
    );
  });

  it('fails on a newest tag without a numeric prefix', () => {
    const journal = buildJournal([buildEntry({ tag: 'custom_migration' })]);

    expect(() => buildMigrationRenamePlan(journal)).toThrow(
      InvalidMigrationTagError,
    );
  });

  it('fails when the newest number is ahead of the target', () => {
    const journal = buildJournal([
      buildEntry({ idx: 0, tag: '0000_initial' }),
      buildEntry({ idx: 1, tag: '0020_balance_movements' }),
      buildEntry({ idx: 2, tag: '0022_hand_numbered' }),
    ]);

    expect(() => buildMigrationRenamePlan(journal)).toThrow(
      MigrationNumberingConflictError,
    );
  });
});

describe('renameDrizzleMigration', () => {
  let drizzleDirectory: string;

  beforeEach(() => {
    drizzleDirectory = mkdtempSync(join(tmpdir(), 'drizzle-numbering-'));
  });

  afterEach(() => {
    rmSync(drizzleDirectory, { recursive: true, force: true });
  });

  it('renames sql, snapshot and journal tag consistently', () => {
    createScratchMigration(drizzleDirectory, '0006_quiet_bloodstorm');

    const plan = renameDrizzleMigration(drizzleDirectory);

    expect(plan.kind).toBe('rename');
    expect(
      existsSync(join(drizzleDirectory, '0006_quiet_bloodstorm.sql')),
    ).toBe(false);
    expect(
      existsSync(join(drizzleDirectory, '0021_quiet_bloodstorm.sql')),
    ).toBe(true);
    expect(
      existsSync(join(drizzleDirectory, 'meta', '0006_snapshot.json')),
    ).toBe(false);
    expect(
      existsSync(join(drizzleDirectory, 'meta', '0021_snapshot.json')),
    ).toBe(true);

    const newest = readJournal(drizzleDirectory).entries.at(-1);
    expect(newest).toMatchObject({ idx: 21, tag: '0021_quiet_bloodstorm' });
  });

  it('changes nothing on a second run', () => {
    createScratchMigration(drizzleDirectory, '0006_quiet_bloodstorm');
    renameDrizzleMigration(drizzleDirectory);

    const journalBeforeSecondRun = readFileSync(
      join(drizzleDirectory, 'meta', '_journal.json'),
      'utf8',
    );
    const plan = renameDrizzleMigration(drizzleDirectory);

    expect(plan.kind).toBe('unchanged');
    expect(
      readFileSync(join(drizzleDirectory, 'meta', '_journal.json'), 'utf8'),
    ).toBe(journalBeforeSecondRun);
    expect(
      existsSync(join(drizzleDirectory, '0021_quiet_bloodstorm.sql')),
    ).toBe(true);
  });

  it('writes the journal with two-space indentation and a trailing newline', () => {
    createScratchMigration(drizzleDirectory, '0006_quiet_bloodstorm');
    renameDrizzleMigration(drizzleDirectory);

    const raw = readFileSync(
      join(drizzleDirectory, 'meta', '_journal.json'),
      'utf8',
    );

    expect(raw.endsWith('}\n')).toBe(true);
    expect(raw).toBe(serialiseJournal(readJournal(drizzleDirectory)));
  });
});

describe('drizzle journal invariant', () => {
  const journal = JSON.parse(
    readFileSync(join(DRIZZLE_DIRECTORY, 'meta', '_journal.json'), 'utf8'),
  ) as DrizzleJournal;

  it('keeps the newest migration one above every previous entry', () => {
    const plan = buildMigrationRenamePlan(journal);

    expect(plan.kind).toBe('unchanged');
    expect(plan.targetIndex).toBe(plan.sourceIndex);
    expect(plan.targetTag).toBe(plan.sourceTag);
  });

  it('gives every entry a unique numeric prefix', () => {
    const prefixes = journal.entries.map((entry) =>
      parseMigrationTagIndex(entry.tag),
    );

    expect(prefixes.every((prefix) => prefix !== null)).toBe(true);
    expect(new Set(prefixes).size).toBe(prefixes.length);
  });

  it('has a sql file and a snapshot file for every entry', () => {
    for (const entry of journal.entries) {
      const prefix = String(parseMigrationTagIndex(entry.tag)).padStart(4, '0');

      expect(existsSync(join(DRIZZLE_DIRECTORY, `${entry.tag}.sql`))).toBe(
        true,
      );
      expect(
        existsSync(join(DRIZZLE_DIRECTORY, 'meta', `${prefix}_snapshot.json`)),
      ).toBe(true);
    }
  });

  it('is serialised with the canonical journal format', () => {
    const raw = readFileSync(
      join(DRIZZLE_DIRECTORY, 'meta', '_journal.json'),
      'utf8',
    );

    expect(raw).toBe(serialiseJournal(journal));
  });
});
