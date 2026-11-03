SET LOCAL lock_timeout = '5s';--> statement-breakpoint
DO $$
BEGIN
  IF to_regclass('public.idx_trans_ws_date_status_type') IS NOT NULL
     AND to_regclass('public.transactions_workspace_id_date_status_type_idx') IS NULL THEN
    ALTER INDEX public.idx_trans_ws_date_status_type RENAME TO transactions_workspace_id_date_status_type_idx;
  END IF;
END $$;--> statement-breakpoint
DROP INDEX IF EXISTS "transactions_workspace_id_date_status_type_idx";--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "transactions_workspace_id_status_date_type_idx" ON "transactions" USING btree ("workspace_id","status","date","type");
