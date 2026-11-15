DO $$
DECLARE
  col RECORD;
BEGIN
  FOR col IN
    SELECT * FROM (VALUES
      ('recurring_transactions', 'end_date'),
      ('recurring_transactions', 'last_generated'),
      ('recurring_transactions', 'start_date'),
      ('subscriptions', 'current_period_end'),
      ('transactions', 'created_at'),
      ('transactions', 'date'),
      ('transactions', 'updated_at'),
      ('users', 'created_at'),
      ('users', 'updated_at'),
      ('workspace_invites', 'expires_at'),
      ('workspace_invites', 'used_at'),
      ('workspace_users', 'joined_at'),
      ('workspaces', 'created_at')
    ) AS columns(table_name, column_name)
  LOOP
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = col.table_name
        AND column_name = col.column_name
        AND data_type = 'timestamp without time zone'
    ) THEN
      EXECUTE format(
        'ALTER TABLE %I ALTER COLUMN %I TYPE timestamp with time zone USING %I AT TIME ZONE ''UTC''',
        col.table_name, col.column_name, col.column_name
      );
    END IF;
  END LOOP;
END
$$;
