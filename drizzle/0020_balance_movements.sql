CREATE TABLE "balance_movements" (
	"seq" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "balance_movements_seq_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"workspace_id" text NOT NULL,
	"account_id" text NOT NULL,
	"transaction_id" text,
	"cause" text NOT NULL,
	"delta" bigint NOT NULL,
	"balance_after" bigint NOT NULL,
	"actor_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "idx_balance_movements_account_seq" ON "balance_movements" USING btree ("account_id","seq");--> statement-breakpoint
CREATE UNIQUE INDEX "ux_balance_movements_opening" ON "balance_movements" USING btree ("account_id") WHERE "balance_movements"."cause" = 'OPENING';