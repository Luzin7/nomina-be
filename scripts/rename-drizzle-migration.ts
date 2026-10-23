import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const TAG_PATTERN = /^(\d{4})_(.+)$/;
const JOURNAL_RELATIVE_PATH = join('meta', '_journal.json');

export type DrizzleJournalEntry = {
  idx: number;
  version: string;
  when: number;
  tag: string;
  breakpoints: boolean;
};

export type DrizzleJournal = {
  version: string;
  dialect: string;
  entries: DrizzleJournalEntry[];
};

export type MigrationRenamePlan = {
  kind: 'rename' | 'unchanged';
  sourceTag: string;
  sourceIndex: number;
  sourceEntryIndex: number;
  targetIndex: number;
  targetTag: string;
};

export class DrizzleMigrationNumberingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DrizzleMigrationNumberingError';
  }
}

export class EmptyJournalError extends DrizzleMigrationNumberingError {
  constructor() {
    super('The Drizzle journal has no migration entries');
    this.name = 'EmptyJournalError';
  }
}

export class InvalidMigrationTagError extends DrizzleMigrationNumberingError {
  constructor(tag: string) {
    super(`Migration tag "${tag}" is not in the expected NNNN_name format`);
    this.name = 'InvalidMigrationTagError';
  }
}

export class MigrationNumberingConflictError extends DrizzleMigrationNumberingError {
  constructor(tag: string, expectedIndex: number) {
    super(
      `Newest migration "${tag}" is numbered ahead of the expected ${formatIndex(
        expectedIndex,
      )}; refusing to guess a target number`,
    );
    this.name = 'MigrationNumberingConflictError';
  }
}

export class MissingMigrationFileError extends DrizzleMigrationNumberingError {
  constructor(path: string) {
    super(`Expected migration file not found: ${path}`);
    this.name = 'MissingMigrationFileError';
  }
}

export class AmbiguousSnapshotFileError extends DrizzleMigrationNumberingError {
  constructor(tag: string, candidates: string[]) {
    super(
      `More than one snapshot matches migration "${tag}": ${candidates.join(
        ', ',
      )}`,
    );
    this.name = 'AmbiguousSnapshotFileError';
  }
}

export class MigrationFileCollisionError extends DrizzleMigrationNumberingError {
  constructor(path: string) {
    super(`Cannot rename migration: target file already exists at ${path}`);
    this.name = 'MigrationFileCollisionError';
  }
}

export function parseMigrationTagIndex(tag: string): number | null {
  const match = TAG_PATTERN.exec(tag);

  return match === null ? null : Number(match[1]);
}

export function buildMigrationRenamePlan(
  journal: DrizzleJournal,
): MigrationRenamePlan {
  if (journal.entries.length === 0) throw new EmptyJournalError();

  const newest = journal.entries[journal.entries.length - 1];
  const sourceIndex = parseMigrationTagIndex(newest.tag);
  if (sourceIndex === null) throw new InvalidMigrationTagError(newest.tag);

  const targetIndex = highestKnownIndex(journal.entries.slice(0, -1)) + 1;
  if (sourceIndex > targetIndex) {
    throw new MigrationNumberingConflictError(newest.tag, targetIndex);
  }

  return {
    kind: sourceIndex === targetIndex ? 'unchanged' : 'rename',
    sourceTag: newest.tag,
    sourceIndex,
    sourceEntryIndex: newest.idx,
    targetIndex,
    targetTag: formatMigrationTag(targetIndex, newest.tag),
  };
}

export function serialiseJournal(journal: DrizzleJournal): string {
  return `${JSON.stringify(journal, null, 2)}\n`;
}

type ApplyMigrationRenameInput = {
  drizzleDirectory: string;
  journal: DrizzleJournal;
  plan: MigrationRenamePlan;
};

export function applyMigrationRename({
  drizzleDirectory,
  journal,
  plan,
}: ApplyMigrationRenameInput): void {
  if (plan.kind === 'rename') {
    renameMigrationFiles({ drizzleDirectory, plan });
    const newestPosition = journal.entries.length - 1;
    journal.entries[newestPosition] = {
      ...journal.entries[newestPosition],
      idx: plan.targetIndex,
      tag: plan.targetTag,
    };
  }

  writeJournalIfChanged(join(drizzleDirectory, JOURNAL_RELATIVE_PATH), journal);
}

export function renameDrizzleMigration(
  drizzleDirectory: string = join(process.cwd(), 'drizzle'),
): MigrationRenamePlan {
  const journalPath = join(drizzleDirectory, JOURNAL_RELATIVE_PATH);
  if (!existsSync(journalPath))
    throw new MissingMigrationFileError(journalPath);

  const journal = JSON.parse(
    readFileSync(journalPath, 'utf8'),
  ) as DrizzleJournal;
  const plan = buildMigrationRenamePlan(journal);

  applyMigrationRename({ drizzleDirectory, journal, plan });

  return plan;
}

function highestKnownIndex(entries: DrizzleJournalEntry[]): number {
  return entries.reduce((highest, entry) => {
    const tagIndex = parseMigrationTagIndex(entry.tag) ?? -1;

    return Math.max(highest, entry.idx, tagIndex);
  }, -1);
}

function formatMigrationTag(index: number, sourceTag: string): string {
  const match = TAG_PATTERN.exec(sourceTag);
  if (match === null) throw new InvalidMigrationTagError(sourceTag);

  return `${formatIndex(index)}_${match[2]}`;
}

function formatIndex(index: number): string {
  return String(index).padStart(4, '0');
}

function snapshotPath(metaDirectory: string, index: number): string {
  return join(metaDirectory, `${formatIndex(index)}_snapshot.json`);
}

type RenameMigrationFilesInput = {
  drizzleDirectory: string;
  plan: MigrationRenamePlan;
};

function renameMigrationFiles({
  drizzleDirectory,
  plan,
}: RenameMigrationFilesInput): void {
  const metaDirectory = join(drizzleDirectory, 'meta');
  const sourceSqlPath = join(drizzleDirectory, `${plan.sourceTag}.sql`);
  const targetSqlPath = join(drizzleDirectory, `${plan.targetTag}.sql`);
  const sourceSnapshotPath = resolveSnapshotPath({
    metaDirectory,
    plan,
  });
  const targetSnapshotPath = snapshotPath(metaDirectory, plan.targetIndex);

  assertPresent(sourceSqlPath);
  assertAbsent(targetSqlPath);
  assertAbsent(targetSnapshotPath);

  renameSync(sourceSnapshotPath, targetSnapshotPath);
  renameSync(sourceSqlPath, targetSqlPath);
}

type ResolveSnapshotPathInput = {
  metaDirectory: string;
  plan: MigrationRenamePlan;
};

function resolveSnapshotPath({
  metaDirectory,
  plan,
}: ResolveSnapshotPathInput): string {
  const candidates = [
    snapshotPath(metaDirectory, plan.sourceEntryIndex),
    snapshotPath(metaDirectory, plan.sourceIndex),
  ].filter((path, position, all) => all.indexOf(path) === position);

  const existing = candidates.filter((path) => existsSync(path));
  if (existing.length === 1) return existing[0];
  if (existing.length === 0) {
    throw new MissingMigrationFileError(candidates.join(', '));
  }

  throw new AmbiguousSnapshotFileError(plan.sourceTag, existing);
}

function assertPresent(path: string): void {
  if (existsSync(path)) return;

  throw new MissingMigrationFileError(path);
}

function assertAbsent(path: string): void {
  if (!existsSync(path)) return;

  throw new MigrationFileCollisionError(path);
}

function writeJournalIfChanged(
  journalPath: string,
  journal: DrizzleJournal,
): void {
  const serialised = serialiseJournal(journal);
  if (
    existsSync(journalPath) &&
    readFileSync(journalPath, 'utf8') === serialised
  )
    return;

  writeFileSync(journalPath, serialised);
}

function main(): void {
  const plan = renameDrizzleMigration();

  if (plan.kind === 'unchanged') {
    console.log(`[drizzle] ${plan.targetTag} already has the newest number`);
    return;
  }

  console.log(`[drizzle] renamed ${plan.sourceTag} to ${plan.targetTag}`);
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
