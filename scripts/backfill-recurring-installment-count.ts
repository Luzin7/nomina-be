import { config } from 'dotenv';
import * as Sentry from '@sentry/nestjs';
import postgres from 'postgres';
import { RecurrenceFrequency } from '../src/constants/enums';
import { DayJsDateProvider } from '../src/providers/date/implementations/Dayjs';
import { inferInstallmentCount } from '../src/utils/installmentSchedule';
import { reportFatalFailure } from './backfill-balance-movements';

config({ path: '.env' });

const SAMPLE_SIZE = 10;

type RunMode = 'dry-run' | 'apply';

export type InstallmentInference = {
  id: string;
  installmentCount: number;
};

export type DryRunReport = {
  candidates: number;
  inferred: InstallmentInference[];
  unmatchedIds: string[];
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

type CandidateRow = {
  id: string;
  frequency: string;
  interval: number;
  time_zone: string;
  start_iso: string;
  end_iso: string;
};

const dateProvider = new DayJsDateProvider();

async function readCandidates(sql: postgres.ISql): Promise<CandidateRow[]> {
  return sql<CandidateRow[]>`
    SELECT rt.id,
           rt.frequency,
           rt.interval,
           a.time_zone,
           to_char(rt.start_date::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS start_iso,
           to_char(rt.end_date::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS end_iso
    FROM recurring_transactions rt
    JOIN accounts a ON a.id = rt.account_id
    WHERE rt.type = 'EXPENSE'
      AND rt.end_date IS NOT NULL
      AND a.type = 'CREDIT_CARD'
      AND rt.installment_count IS NULL
    ORDER BY rt.id
  `;
}

function inferCandidate(row: CandidateRow): number | null {
  return inferInstallmentCount(
    {
      startDate: new Date(row.start_iso),
      endDate: new Date(row.end_iso),
      frequency: row.frequency as RecurrenceFrequency,
      interval: row.interval,
      timezone: row.time_zone,
    },
    dateProvider,
  );
}

function classify(rows: CandidateRow[]): DryRunReport {
  const inferred: InstallmentInference[] = [];
  const unmatchedIds: string[] = [];

  for (const row of rows) {
    const installmentCount = inferCandidate(row);
    if (installmentCount === null) {
      unmatchedIds.push(row.id);
      continue;
    }

    inferred.push({ id: row.id, installmentCount });
  }

  return { candidates: rows.length, inferred, unmatchedIds };
}

export async function readDryRunReport(
  sql: postgres.Sql,
): Promise<DryRunReport> {
  return sql.begin('ISOLATION LEVEL REPEATABLE READ READ ONLY', async (tx) => {
    await tx`SET LOCAL TIME ZONE 'UTC'`;

    return classify(await readCandidates(tx));
  });
}

export async function applyInstallmentCountBackfill(
  sql: postgres.Sql,
): Promise<number> {
  return sql.begin(async (tx) => {
    await tx`SET LOCAL TIME ZONE 'UTC'`;

    const { inferred } = classify(await readCandidates(tx));
    let updated = 0;
    for (const { id, installmentCount } of inferred) {
      const rows = await tx<{ id: string }[]>`
        UPDATE recurring_transactions
        SET installment_count = ${installmentCount}
        WHERE id = ${id}
          AND installment_count IS NULL
        RETURNING id
      `;
      updated += rows.length;
    }

    return updated;
  });
}

function distributionOf(
  inferred: InstallmentInference[],
): Record<number, number> {
  return inferred.reduce<Record<number, number>>((distribution, row) => {
    distribution[row.installmentCount] =
      (distribution[row.installmentCount] ?? 0) + 1;

    return distribution;
  }, {});
}

function printDryRun(report: DryRunReport): void {
  console.log('Recurring installment_count backfill — DRY RUN (no writes)');
  console.log(`candidates: ${report.candidates}`);
  console.log(`inferred: ${report.inferred.length}`);
  console.log(`unmatched (left NULL): ${report.unmatchedIds.length}`);
  console.log(
    `installment distribution: ${JSON.stringify(distributionOf(report.inferred))}`,
  );
  console.log('');
  console.log('id\tinstallment_count');
  for (const row of report.inferred.slice(0, SAMPLE_SIZE)) {
    console.log(`${row.id}\t${row.installmentCount}`);
  }
  console.log('');
  console.log(
    JSON.stringify({
      mode: 'dry-run',
      candidates: report.candidates,
      inferred: report.inferred.length,
      unmatched: report.unmatchedIds.length,
    }),
  );
}

async function main(): Promise<void> {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    enabled: Boolean(process.env.SENTRY_DSN),
  });

  const mode = parseMode(process.argv.slice(2));
  const sql = postgres(resolveDatabaseUrl(), {
    max: 1,
    connect_timeout: 10,
    onnotice: () => undefined,
  });

  try {
    if (mode === 'dry-run') {
      printDryRun(await readDryRunReport(sql));
      return;
    }

    const updated = await applyInstallmentCountBackfill(sql);
    console.log(JSON.stringify({ mode: 'apply', updated }));
  } finally {
    await sql.end({ timeout: 5 });
  }
}

if (require.main === module) {
  main().catch(reportFatalFailure);
}
