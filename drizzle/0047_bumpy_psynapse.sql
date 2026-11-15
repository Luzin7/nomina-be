ALTER TABLE "goals" ADD COLUMN "progress_source" text DEFAULT 'manual' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "unq_goal_account_source" ON "goals" USING btree ("linked_account_id") WHERE "goals"."progress_source" = 'account';--> statement-breakpoint
ALTER TABLE "goals" ADD CONSTRAINT "chk_goal_progress_source_valid" CHECK ("goals"."progress_source" IN ('manual', 'account'));--> statement-breakpoint
ALTER TABLE "goals" ADD CONSTRAINT "chk_goal_account_source_requires_link" CHECK ("goals"."progress_source" = 'manual' OR "goals"."linked_account_id" IS NOT NULL);