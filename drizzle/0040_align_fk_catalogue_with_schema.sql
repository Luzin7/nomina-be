DO $$
DECLARE
  fk RECORD;
BEGIN
  FOR fk IN
    SELECT * FROM (VALUES
      ('accounts', 'accounts_workspace_id_fkey', 'accounts_workspace_id_workspaces_id_fk'),
      ('categories', 'categories_parent_id_fkey', 'categories_parent_id_categories_id_fk'),
      ('categories', 'categories_workspace_id_fkey', 'categories_workspace_id_workspaces_id_fk'),
      ('recurring_transactions', 'recurring_transactions_workspace_id_fkey', 'recurring_transactions_workspace_id_workspaces_id_fk'),
      ('transactions', 'transactions_category_id_fkey', 'transactions_category_id_categories_id_fk'),
      ('transactions', 'transactions_workspace_id_fkey', 'transactions_workspace_id_workspaces_id_fk'),
      ('workspace_users', 'workspace_users_user_id_fkey', 'workspace_users_user_id_users_id_fk'),
      ('workspace_users', 'workspace_users_workspace_id_fkey', 'workspace_users_workspace_id_workspaces_id_fk'),
      ('subscriptions', 'subscriptions_user_id_fkey', 'subscriptions_user_id_users_id_fk'),
      ('workspace_invites', 'workspace_invites_created_by_fkey', 'workspace_invites_created_by_users_id_fk'),
      ('workspace_invites', 'workspace_invites_workspace_id_fkey', 'workspace_invites_workspace_id_workspaces_id_fk')
    ) AS renames(table_name, old_name, new_name)
  LOOP
    IF EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conname = fk.old_name
        AND conrelid = format('public.%I', fk.table_name)::regclass
    ) AND NOT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conname = fk.new_name
        AND conrelid = format('public.%I', fk.table_name)::regclass
    ) THEN
      EXECUTE format('ALTER TABLE %I RENAME CONSTRAINT %I TO %I', fk.table_name, fk.old_name, fk.new_name);
    END IF;
  END LOOP;
END
$$;
--> statement-breakpoint
DO $$
DECLARE
  orphan_count bigint;
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'recurring_transactions_category_id_categories_id_fk'
      AND conrelid = 'public.recurring_transactions'::regclass
  ) THEN
    RETURN;
  END IF;

  SELECT count(*) INTO orphan_count
  FROM recurring_transactions r
  LEFT JOIN categories c ON c.id = r.category_id
  WHERE r.category_id IS NOT NULL
    AND c.id IS NULL;

  IF orphan_count > 0 THEN
    RAISE EXCEPTION 'recurring_transactions has % rows with category_id pointing to a missing category', orphan_count;
  END IF;

  ALTER TABLE "recurring_transactions" ADD CONSTRAINT "recurring_transactions_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE no action ON UPDATE no action;
END
$$;
