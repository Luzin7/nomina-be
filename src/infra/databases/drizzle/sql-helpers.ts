import { AnyColumn, SQL, sql } from 'drizzle-orm';

export const localDayIn = (
  instant: SQL,
  timezone: SQL | SQL.Aliased | AnyColumn,
): SQL => sql`(${instant} AT TIME ZONE ${timezone})::date`;

export const instantOf = (column: AnyColumn | SQL): SQL =>
  sql`to_timestamp(EXTRACT(EPOCH FROM ${column}))`;

export const epochMsInUtc = (column: AnyColumn | SQL): SQL<string> =>
  sql<string>`(EXTRACT(EPOCH FROM ${column}) * 1000)::bigint`;

export const epochMsToDate = (epochMs: string): Date =>
  new Date(Number(epochMs));

export type LocalDayRange = {
  start: string;
  end: string;
  timezone: string;
};

const dayEdge = (day: string, offsetDays: number, timezone: string): SQL =>
  sql`((${day}::date + ${sql.raw(String(offsetDays))})::timestamp AT TIME ZONE ${timezone}::text)`;

// A naive date column coerces a timestamptz bound through the session time zone, so the range is padded one day each side and the local-day filter keeps the window (drizzle/pre-checks/0042_timestamps_with_timezone).
export const withinLocalDays = (
  instant: AnyColumn | SQL,
  { start, end, timezone }: LocalDayRange,
): SQL =>
  sql`${instant} >= ${dayEdge(start, -1, timezone)} AND ${instant} < ${dayEdge(end, 2, timezone)} AND ${localDayIn(instantOf(instant), sql`${timezone}::text`)} BETWEEN ${start}::date AND ${end}::date`;
