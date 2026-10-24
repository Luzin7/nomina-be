import { AnyColumn, SQL, sql } from 'drizzle-orm';

export const localDayIn = (
  instant: SQL,
  timezone: SQL | SQL.Aliased | AnyColumn,
): SQL => sql`(${instant} AT TIME ZONE ${timezone})::date`;
