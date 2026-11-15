INSERT INTO categories (id, workspace_id, name, type, is_system_category, parent_id)
SELECT gen_random_uuid()::text, w.id, 'Investimentos', 'EXPENSE', false, NULL
FROM workspaces w
WHERE NOT EXISTS (
  SELECT 1
  FROM categories c
  WHERE c.workspace_id = w.id
    AND c.name = 'Investimentos'
    AND c.type = 'EXPENSE'
    AND c.parent_id IS NULL
);--> statement-breakpoint
DROP INDEX IF EXISTS "unq_cat_ws_name_type_parent";--> statement-breakpoint
CREATE UNIQUE INDEX "unq_cat_ws_name_type_parent" ON "categories" USING btree ("workspace_id","name","type","parent_id") NULLS NOT DISTINCT;
