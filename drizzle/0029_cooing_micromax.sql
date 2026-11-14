SET LOCAL lock_timeout = '5s';--> statement-breakpoint
CREATE TABLE "recurring_suggestion_transactions" (
	"suggestion_id" text NOT NULL,
	"transaction_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "recurring_suggestions" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"category_id" text NOT NULL,
	"account_id" text NOT NULL,
	"suggested_title" text NOT NULL,
	"amount" bigint NOT NULL,
	"day_of_month" integer NOT NULL,
	"status" text NOT NULL,
	"recurring_id" text,
	"shown_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN "last_bill_detection_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "recurring_suggestion_transactions" ADD CONSTRAINT "recurring_suggestion_transactions_suggestion_id_recurring_suggestions_id_fk" FOREIGN KEY ("suggestion_id") REFERENCES "public"."recurring_suggestions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_suggestion_transactions" ADD CONSTRAINT "recurring_suggestion_transactions_transaction_id_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."transactions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_suggestions" ADD CONSTRAINT "recurring_suggestions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_suggestions" ADD CONSTRAINT "recurring_suggestions_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_suggestions" ADD CONSTRAINT "recurring_suggestions_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_suggestions" ADD CONSTRAINT "recurring_suggestions_recurring_id_recurring_transactions_id_fk" FOREIGN KEY ("recurring_id") REFERENCES "public"."recurring_transactions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "unq_recurring_suggestion_transaction" ON "recurring_suggestion_transactions" USING btree ("transaction_id");--> statement-breakpoint
CREATE INDEX "idx_recurring_suggestion_transaction_suggestion" ON "recurring_suggestion_transactions" USING btree ("suggestion_id");--> statement-breakpoint
CREATE INDEX "idx_recurring_suggestion_ws_status" ON "recurring_suggestions" USING btree ("workspace_id","status");--> statement-breakpoint
CREATE INDEX "idx_recurring_suggestion_ws_category" ON "recurring_suggestions" USING btree ("workspace_id","category_id");