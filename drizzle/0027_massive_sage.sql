CREATE TABLE "budget_allocations" (
	"id" text PRIMARY KEY NOT NULL,
	"budget_id" text NOT NULL,
	"category_id" text NOT NULL,
	"group_name" text NOT NULL,
	"group_order" integer NOT NULL,
	"category_order" integer NOT NULL,
	"percentage_of_income" integer NOT NULL,
	"target_cents" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "budgets" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"effective_from" timestamp with time zone NOT NULL,
	"monthly_income" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "budget_allocations" ADD CONSTRAINT "budget_allocations_budget_id_budgets_id_fk" FOREIGN KEY ("budget_id") REFERENCES "public"."budgets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_allocations" ADD CONSTRAINT "budget_allocations_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budgets" ADD CONSTRAINT "budgets_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "unq_budget_allocation_budget_category" ON "budget_allocations" USING btree ("budget_id","category_id");--> statement-breakpoint
CREATE INDEX "idx_budget_allocation_budget" ON "budget_allocations" USING btree ("budget_id");--> statement-breakpoint
CREATE INDEX "idx_budget_allocation_category" ON "budget_allocations" USING btree ("category_id");--> statement-breakpoint
CREATE UNIQUE INDEX "unq_budget_ws_effective_from" ON "budgets" USING btree ("workspace_id","effective_from");--> statement-breakpoint
CREATE INDEX "idx_budget_ws" ON "budgets" USING btree ("workspace_id");