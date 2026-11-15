DO $$
DECLARE
  fk RECORD;
BEGIN
  FOR fk IN
    SELECT * FROM (VALUES
      ('accounts', 'accounts_workspace_id_workspaces_id_fk', 'c', 'c', 'FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE cascade'),
      ('categories', 'categories_workspace_id_workspaces_id_fk', 'c', 'c', 'FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE cascade'),
      ('categories', 'categories_parent_id_categories_id_fk', 'n', 'c', 'FOREIGN KEY ("parent_id") REFERENCES "public"."categories"("id") ON DELETE set null ON UPDATE cascade'),
      ('recurring_transactions', 'recurring_transactions_workspace_id_workspaces_id_fk', 'c', 'c', 'FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE cascade'),
      ('subscriptions', 'subscriptions_user_id_users_id_fk', 'r', 'c', 'FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE cascade'),
      ('transactions', 'transactions_workspace_id_workspaces_id_fk', 'c', 'c', 'FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE cascade'),
      ('transactions', 'transactions_category_id_categories_id_fk', 'r', 'c', 'FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE restrict ON UPDATE cascade'),
      ('workspace_invites', 'workspace_invites_workspace_id_workspaces_id_fk', 'c', 'c', 'FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE cascade'),
      ('workspace_invites', 'workspace_invites_created_by_users_id_fk', 'c', 'c', 'FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE cascade'),
      ('workspace_users', 'workspace_users_workspace_id_workspaces_id_fk', 'c', 'c', 'FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE cascade'),
      ('workspace_users', 'workspace_users_user_id_users_id_fk', 'c', 'c', 'FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE cascade')
    ) AS actions(table_name, constraint_name, delete_action, update_action, definition)
  LOOP
    IF EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conname = fk.constraint_name
        AND conrelid = format('public.%I', fk.table_name)::regclass
        AND confdeltype = fk.delete_action::"char"
        AND confupdtype = fk.update_action::"char"
    ) THEN
      CONTINUE;
    END IF;

    EXECUTE format('ALTER TABLE %I DROP CONSTRAINT %I', fk.table_name, fk.constraint_name);
    EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I %s', fk.table_name, fk.constraint_name, fk.definition);
  END LOOP;
END
$$;
