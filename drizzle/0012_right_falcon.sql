ALTER TABLE "accounts" ADD COLUMN "closing_days_before_due" integer DEFAULT 7 NOT NULL;--> statement-breakpoint
CREATE INDEX "idx_account_ws" ON "accounts" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "idx_account_type" ON "accounts" USING btree ("type");--> statement-breakpoint
CREATE INDEX "idx_account_closing_due" ON "accounts" USING btree ("closing_days_before_due","due_day");--> statement-breakpoint
ALTER TABLE "accounts" DROP COLUMN "closing_day";