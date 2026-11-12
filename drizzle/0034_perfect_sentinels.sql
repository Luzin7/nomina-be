CREATE TABLE "card_invoice_settlements" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"card_account_id" text NOT NULL,
	"invoice_period_month" integer NOT NULL,
	"invoice_period_year" integer NOT NULL,
	"transaction_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "unq_card_invoice_settlement" UNIQUE("card_account_id","invoice_period_month","invoice_period_year")
);
--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "auto_pay_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "auto_pay_confirmed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "auto_pay_enabled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "auto_pay_source_account_id" text;--> statement-breakpoint
ALTER TABLE "card_invoice_settlements" ADD CONSTRAINT "card_invoice_settlements_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "card_invoice_settlements" ADD CONSTRAINT "card_invoice_settlements_card_account_id_accounts_id_fk" FOREIGN KEY ("card_account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "card_invoice_settlements" ADD CONSTRAINT "card_invoice_settlements_transaction_id_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."transactions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_card_invoice_settlement_ws" ON "card_invoice_settlements" USING btree ("workspace_id");--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_auto_pay_source_account_id_accounts_id_fk" FOREIGN KEY ("auto_pay_source_account_id") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;