CREATE TABLE "balance_adjustments" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"account_id" text NOT NULL,
	"actor_id" text NOT NULL,
	"expected_balance_cents" bigint NOT NULL,
	"target_balance_cents" bigint NOT NULL,
	"delta_cents" bigint NOT NULL,
	"movement_seq" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "balance_adjustments" ADD CONSTRAINT "balance_adjustments_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "balance_adjustments" ADD CONSTRAINT "balance_adjustments_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "balance_adjustments" ADD CONSTRAINT "balance_adjustments_movement_seq_balance_movements_seq_fk" FOREIGN KEY ("movement_seq") REFERENCES "public"."balance_movements"("seq") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_balance_adjustments_account_created" ON "balance_adjustments" USING btree ("account_id","created_at" DESC NULLS LAST);