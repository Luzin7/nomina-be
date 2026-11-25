ALTER TABLE "workspaces" ADD COLUMN "cycle" text DEFAULT 'monthly' NOT NULL;--> statement-breakpoint
CREATE INDEX "balance_movements_transaction_id_account_id_idx" ON "balance_movements" USING btree ("transaction_id","account_id");--> statement-breakpoint
ALTER TABLE "workspaces" ADD CONSTRAINT "chk_workspaces_cycle" CHECK ("workspaces"."cycle" IN ('monthly', 'half_month', 'weekly'));