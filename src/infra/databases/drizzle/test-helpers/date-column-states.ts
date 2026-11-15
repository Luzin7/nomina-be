import postgres from 'postgres';

export type ColumnState =
  | 'timestamp without time zone'
  | 'timestamp with time zone';

export const DATE_COLUMN_CASES: {
  columns: ColumnState;
  sessionTimeZone: string;
}[] = [
  { columns: 'timestamp without time zone', sessionTimeZone: 'UTC' },
  { columns: 'timestamp without time zone', sessionTimeZone: 'America/Recife' },
  { columns: 'timestamp with time zone', sessionTimeZone: 'UTC' },
  { columns: 'timestamp with time zone', sessionTimeZone: 'America/Recife' },
];

const CONVERTED_COLUMNS = [
  ['transactions', 'date'],
  ['recurring_transactions', 'start_date'],
  ['recurring_transactions', 'end_date'],
  ['recurring_transactions', 'last_generated'],
];

export async function setDateColumns(client: postgres.Sql, state: ColumnState) {
  for (const [table, column] of CONVERTED_COLUMNS) {
    await client.unsafe(
      `ALTER TABLE ${table} ALTER COLUMN ${column} TYPE ${state} USING ${column} AT TIME ZONE 'UTC'`,
    );
  }
}
