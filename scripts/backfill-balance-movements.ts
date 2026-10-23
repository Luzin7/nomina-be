import { config } from 'dotenv';
import * as Sentry from '@sentry/nestjs';
import postgres from 'postgres';
import { BALANCE_BACKFILL_ACTOR } from '../src/constants/actors';
import { BalanceMovementCause } from '../src/constants/enums';

config({ path: '.env' });

const TOP_DIVERGED_ACCOUNTS = 10;

type RunMode = 'dry-run' | 'apply';

export type AccountSnapshot = {
  id: string;
  workspaceId: string;
  name: string;
  balance: bigint;
  existing: bigint;
  opening: bigint;
  hasOpening: boolean;
};

type SnapshotRow = {
  id: string;
  workspace_id: string;
  name: string;
  balance: string;
  existing: string;
  opening_rows: number;
};

type ApplyOutcome =
  | { kind: 'already-covered' }
  | { kind: 'covered'; opening: bigint };

type OpeningDistribution = {
  negative: number;
  zero: number;
  positive: number;
};

type BackfillSummary = {
  covered: number;
  alreadyCovered: number;
  openingsInserted: number;
  totalOpening: bigint;
  distribution: OpeningDistribution;
};

type FailedAccount = {
  id: string;
  reason: string;
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

class AccountNotFoundError extends Error {
  constructor(accountId: string) {
    super(`Conta não encontrada: ${accountId}`);
    this.name = 'AccountNotFoundError';
  }
}

class LedgerMismatchError extends Error {
  constructor(accountId: string, recordedSum: bigint, balance: bigint) {
    super(
      `Somatório de balance_movements (${recordedSum}) difere do saldo da conta ${accountId} (${balance}); conta ignorada nesta execução (tráfego concorrente pode ter alterado o saldo entre a leitura e a inserção) — execute o backfill novamente`,
    );
    this.name = 'LedgerMismatchError';
  }
}

export class BackfillAccountsFailedError extends Error {
  constructor(readonly failures: FailedAccount[]) {
    super(
      `Balance movements backfill failed for ${failures.length} account(s)`,
    );
    this.name = 'BackfillAccountsFailedError';
  }
}

function initAlerting(): void {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    enabled: Boolean(process.env.SENTRY_DSN),
  });
}

export async function alertBackfillFailure(
  error: Error,
  extra?: Record<string, unknown>,
): Promise<void> {
  if (!process.env.SENTRY_DSN) {
    console.error(
      'SENTRY_DSN is not set: the backfill failure was not delivered to Sentry.',
    );
    return;
  }

  Sentry.captureException(error, extra ? { extra } : undefined);
  const flushed = await Sentry.flush(2_000);
  if (!flushed) {
    console.error('Sentry flush timed out: the backfill failure may be lost.');
  }
}

export async function reportFailedAccounts(
  failedAccounts: FailedAccount[],
): Promise<void> {
  console.error(
    'Contas com falha (transação revertida, re-execute o backfill):',
  );
  for (const failure of failedAccounts) {
    console.error(`${failure.id}\t${failure.reason}`);
  }
  process.exitCode = 1;
  await alertBackfillFailure(new BackfillAccountsFailedError(failedAccounts), {
    failedAccounts,
  });
}

export async function reportFatalFailure(error: unknown): Promise<void> {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
  await alertBackfillFailure(
    error instanceof Error ? error : new Error(String(error)),
  );
}

function parseMode(argv: string[]): RunMode {
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

async function readAccountSnapshots(
  sql: postgres.ISql,
  accountId?: string,
): Promise<AccountSnapshot[]> {
  const accountFilter = accountId ? sql`WHERE a.id = ${accountId}` : sql``;

  const rows = await sql<SnapshotRow[]>`
    WITH movements AS (
      SELECT account_id,
             SUM(delta)::bigint AS existing,
             COUNT(*) FILTER (WHERE cause = 'OPENING')::int AS opening_rows
      FROM balance_movements
      GROUP BY account_id
    )
    SELECT a.id,
           a.workspace_id,
           a.name,
           a.balance::bigint AS balance,
           COALESCE(m.existing, 0)::bigint AS existing,
           COALESCE(m.opening_rows, 0) AS opening_rows
    FROM accounts a
    LEFT JOIN movements m ON m.account_id = a.id
    ${accountFilter}
    ORDER BY a.id
  `;

  return rows.map((row) => {
    const balance = BigInt(row.balance);
    const existing = BigInt(row.existing);

    return {
      id: row.id,
      workspaceId: row.workspace_id,
      name: row.name,
      balance,
      existing,
      opening: balance - existing,
      hasOpening: row.opening_rows > 0,
    };
  });
}

async function assertLedgerMatchesBalance(
  sql: postgres.ISql,
  account: AccountSnapshot,
): Promise<void> {
  const [totals] = await sql<{ movements_sum: string; balance: string }[]>`
    SELECT (SELECT COALESCE(SUM(delta), 0)::bigint
            FROM balance_movements
            WHERE account_id = ${account.id}) AS movements_sum,
           a.balance::bigint AS balance
    FROM accounts a
    WHERE a.id = ${account.id}
  `;

  const recordedSum = BigInt(totals.movements_sum);
  const balance = BigInt(totals.balance);
  if (recordedSum !== balance) {
    throw new LedgerMismatchError(account.id, recordedSum, balance);
  }
}

export async function insertOpening(
  sql: postgres.ISql,
  account: AccountSnapshot,
): Promise<void> {
  await sql`
    INSERT INTO balance_movements
      (workspace_id, account_id, transaction_id, cause, delta, balance_after, actor_id)
    VALUES
      (${account.workspaceId}, ${account.id}, NULL,
       ${BalanceMovementCause.OPENING}, ${account.opening.toString()},
       ${account.balance.toString()}, ${BALANCE_BACKFILL_ACTOR})
  `;
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: string }).code === '23505'
  );
}

async function applyAccount(
  sql: postgres.Sql,
  accountId: string,
): Promise<ApplyOutcome> {
  try {
    return await sql.begin(async (tx) => {
      const [account] = await readAccountSnapshots(tx, accountId);
      if (!account) throw new AccountNotFoundError(accountId);
      if (account.hasOpening) return { kind: 'already-covered' };

      await insertOpening(tx, account);
      await assertLedgerMatchesBalance(tx, account);

      return { kind: 'covered', opening: account.opening };
    });
  } catch (error) {
    if (isUniqueViolation(error)) return { kind: 'already-covered' };
    throw error;
  }
}

function sum(values: bigint[]): bigint {
  return values.reduce((total, value) => total + value, 0n);
}

function toNumber(value: bigint): number {
  return Number(value);
}

function absolute(value: bigint): bigint {
  return value < 0n ? -value : value;
}

function compareDescending(left: bigint, right: bigint): number {
  if (left === right) return 0;

  return left < right ? 1 : -1;
}

function formatRow(cells: (string | number | bigint)[]): string {
  return cells.map((cell) => String(cell)).join('\t');
}

function distributionOf(accounts: AccountSnapshot[]): OpeningDistribution {
  return accounts.reduce<OpeningDistribution>(
    (distribution, account) => {
      if (account.opening < 0n) distribution.negative += 1;
      else if (account.opening === 0n) distribution.zero += 1;
      else distribution.positive += 1;

      return distribution;
    },
    { negative: 0, zero: 0, positive: 0 },
  );
}

function printDryRun(accounts: AccountSnapshot[]): BackfillSummary {
  const pending = accounts.filter((account) => !account.hasOpening);
  const ranked = [...pending].sort((left, right) =>
    compareDescending(absolute(left.opening), absolute(right.opening)),
  );

  const totalOpening = sum(pending.map((account) => account.opening));
  const distribution = distributionOf(pending);

  console.log('Balance movements backfill — DRY RUN (no writes)');
  console.log(
    'opening = the stored balance minus the movements already recorded',
  );
  console.log(`accounts scanned: ${accounts.length}`);
  console.log(`covered: ${pending.length}`);
  console.log(`alreadyCovered: ${accounts.length - pending.length}`);
  console.log(`total opening: ${totalOpening}`);
  console.log(
    `opening distribution: negative=${distribution.negative} zero=${distribution.zero} positive=${distribution.positive}`,
  );
  console.log('');
  console.log(
    formatRow(['id', 'name', 'workspace_id', 'balance', 'existing', 'opening']),
  );
  for (const account of ranked.slice(0, TOP_DIVERGED_ACCOUNTS)) {
    console.log(
      formatRow([
        account.id,
        account.name,
        account.workspaceId,
        account.balance,
        account.existing,
        account.opening,
      ]),
    );
  }

  return {
    covered: pending.length,
    alreadyCovered: accounts.length - pending.length,
    openingsInserted: 0,
    totalOpening,
    distribution,
  };
}

async function runDryRun(sql: postgres.ISql): Promise<BackfillSummary> {
  const accounts = await readAccountSnapshots(sql);
  const summary = printDryRun(accounts);

  console.log('');
  console.log(
    JSON.stringify({
      mode: 'dry-run',
      ...serializeSummary(summary),
      plannedOpenings: summary.covered,
    }),
  );

  return summary;
}

function serializeSummary(summary: BackfillSummary): Record<string, unknown> {
  return {
    covered: summary.covered,
    alreadyCovered: summary.alreadyCovered,
    openingsInserted: summary.openingsInserted,
    totalOpening: toNumber(summary.totalOpening),
    distribution: summary.distribution,
  };
}

export async function runApply(sql: postgres.Sql): Promise<{
  summary: BackfillSummary;
  failedAccounts: FailedAccount[];
}> {
  const accountIds = (await readAccountSnapshots(sql)).map(
    (account) => account.id,
  );

  const failedAccounts: FailedAccount[] = [];
  const summary: BackfillSummary = {
    covered: 0,
    alreadyCovered: 0,
    openingsInserted: 0,
    totalOpening: 0n,
    distribution: { negative: 0, zero: 0, positive: 0 },
  };

  for (const accountId of accountIds) {
    try {
      const outcome = await applyAccount(sql, accountId);
      if (outcome.kind === 'already-covered') {
        summary.alreadyCovered += 1;
        continue;
      }

      summary.covered += 1;
      summary.openingsInserted += 1;
      summary.totalOpening += outcome.opening;
      if (outcome.opening < 0n) summary.distribution.negative += 1;
      else if (outcome.opening === 0n) summary.distribution.zero += 1;
      else summary.distribution.positive += 1;
    } catch (error) {
      failedAccounts.push({
        id: accountId,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return { summary, failedAccounts };
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
    if (mode === 'dry-run') {
      await runDryRun(sql);
      return;
    }

    const { summary, failedAccounts } = await runApply(sql);
    console.log(
      JSON.stringify({ mode: 'apply', ...serializeSummary(summary) }),
    );

    if (failedAccounts.length === 0) return;

    await reportFailedAccounts(failedAccounts);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

if (require.main === module) {
  main().catch(reportFatalFailure);
}
