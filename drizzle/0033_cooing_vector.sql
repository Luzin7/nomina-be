CREATE TABLE "goals" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"name" text NOT NULL,
	"target_cents" bigint DEFAULT 0 NOT NULL,
	"current_cents" bigint DEFAULT 0 NOT NULL,
	"monthly_aporte_cents" bigint DEFAULT 0 NOT NULL,
	"linked_account_id" text,
	"category_id" text,
	"is_emergency" boolean DEFAULT false NOT NULL,
	"is_system" boolean DEFAULT false NOT NULL,
	"dismissed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chk_goal_target_cents_non_negative" CHECK ("goals"."target_cents" >= 0),
	CONSTRAINT "chk_goal_current_cents_non_negative" CHECK ("goals"."current_cents" >= 0),
	CONSTRAINT "chk_goal_monthly_aporte_cents_non_negative" CHECK ("goals"."monthly_aporte_cents" >= 0)
);
--> statement-breakpoint
ALTER TABLE "goals" ADD CONSTRAINT "goals_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goals" ADD CONSTRAINT "goals_linked_account_id_accounts_id_fk" FOREIGN KEY ("linked_account_id") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goals" ADD CONSTRAINT "goals_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "unq_goal_ws_emergency" ON "goals" USING btree ("workspace_id") WHERE "goals"."is_emergency";--> statement-breakpoint
CREATE INDEX "idx_goal_ws" ON "goals" USING btree ("workspace_id");