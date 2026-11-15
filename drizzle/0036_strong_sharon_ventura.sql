SET LOCAL lock_timeout = '5s';--> statement-breakpoint
CREATE TABLE "budget_category_groups" (
	"category_name" text PRIMARY KEY NOT NULL,
	"budget_group" text NOT NULL,
	CONSTRAINT "chk_budget_category_group_value" CHECK ("budget_category_groups"."budget_group" IN ('essentials', 'lifestyle', 'savings'))
);
--> statement-breakpoint
CREATE TABLE "budget_income_brackets" (
	"version" integer NOT NULL,
	"position" integer NOT NULL,
	"max_minimum_wages" numeric(6, 2),
	"essentials_bp" integer NOT NULL,
	"lifestyle_bp" integer NOT NULL,
	"savings_bp" integer NOT NULL,
	CONSTRAINT "budget_income_brackets_version_position_pk" PRIMARY KEY("version","position"),
	CONSTRAINT "chk_budget_income_bracket_bp_total" CHECK ("budget_income_brackets"."essentials_bp" + "budget_income_brackets"."lifestyle_bp" + "budget_income_brackets"."savings_bp" = 10000)
);
--> statement-breakpoint
CREATE TABLE "budget_parameters" (
	"key" text NOT NULL,
	"effective_from" date NOT NULL,
	"value_cents" bigint NOT NULL,
	CONSTRAINT "budget_parameters_key_effective_from_pk" PRIMARY KEY("key","effective_from")
);
--> statement-breakpoint
CREATE TABLE "budget_suggestion_decisions" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"kind" text NOT NULL,
	"month" date NOT NULL,
	"decision" text NOT NULL,
	"income_cents" bigint,
	"bracket_version" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "unq_budget_suggestion_decision_ws_kind_month" UNIQUE("workspace_id","kind","month"),
	CONSTRAINT "chk_budget_suggestion_decision_kind" CHECK ("budget_suggestion_decisions"."kind" IN ('income', 'split')),
	CONSTRAINT "chk_budget_suggestion_decision_value" CHECK ("budget_suggestion_decisions"."decision" IN ('accepted', 'rejected'))
);
--> statement-breakpoint
ALTER TABLE "budget_allocations" ALTER COLUMN "percentage_of_income" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "budgets" ALTER COLUMN "monthly_income" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "budget_suggestion_decisions" ADD CONSTRAINT "budget_suggestion_decisions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;