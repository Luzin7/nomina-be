CREATE TABLE "card_cycle_budgets" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"account_id" text NOT NULL,
	"effective_from" text NOT NULL,
	"limit_cents" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "card_cycle_periods" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"account_id" text NOT NULL,
	"due_date" text NOT NULL,
	"period_start" text NOT NULL,
	"period_end" text NOT NULL,
	"due_day" integer NOT NULL,
	"closing_days_before_due" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "card_cycle_budgets" ADD CONSTRAINT "card_cycle_budgets_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "card_cycle_budgets" ADD CONSTRAINT "card_cycle_budgets_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "card_cycle_periods" ADD CONSTRAINT "card_cycle_periods_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "card_cycle_periods" ADD CONSTRAINT "card_cycle_periods_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "unq_card_cycle_budget_account_effective" ON "card_cycle_budgets" USING btree ("account_id","effective_from");--> statement-breakpoint
CREATE UNIQUE INDEX "unq_card_cycle_period_account_due" ON "card_cycle_periods" USING btree ("account_id","due_date");--> statement-breakpoint
CREATE INDEX "idx_card_cycle_period_ws_account" ON "card_cycle_periods" USING btree ("workspace_id","account_id");