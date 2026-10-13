CREATE TABLE "accounts" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"balance" bigint DEFAULT 0 NOT NULL,
	"time_zone" text DEFAULT 'America/Sao_Paulo' NOT NULL,
	"closing_days_before_due" integer DEFAULT 7 NOT NULL,
	"due_day" integer,
	"credit_limit" bigint
);
--> statement-breakpoint
CREATE TABLE "categories" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"is_system_category" boolean DEFAULT false NOT NULL,
	"parent_id" text
);
--> statement-breakpoint
CREATE TABLE "recurring_transactions" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"account_id" text NOT NULL,
	"destination_account_id" text,
	"category_id" text NOT NULL,
	"type" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"amount" bigint NOT NULL,
	"frequency" text NOT NULL,
	"interval" integer DEFAULT 1 NOT NULL,
	"start_date" timestamp with time zone NOT NULL,
	"end_date" timestamp with time zone,
	"last_generated" timestamp with time zone,
	"active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "refresh_tokens" (
	"id" text PRIMARY KEY NOT NULL,
	"token" text NOT NULL,
	"expires_in" timestamp with time zone NOT NULL,
	"user_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "subscriptions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"planId" text NOT NULL,
	"status" text NOT NULL,
	"current_period_end" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "transactions" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"account_id" text NOT NULL,
	"category_id" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"amount" bigint NOT NULL,
	"date" timestamp with time zone NOT NULL,
	"type" text NOT NULL,
	"status" text NOT NULL,
	"installment_group_id" text,
	"installment_number" integer,
	"installment_count" integer,
	"recurring_transaction_id" text,
	"destination_account_id" text,
	"invoice_period_month" integer,
	"invoice_period_year" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"name" text NOT NULL,
	"phone" text,
	"avatar_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "workspace_invites" (
	"id" text PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"workspace_id" text NOT NULL,
	"role" text NOT NULL,
	"created_by" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"used_by" text,
	CONSTRAINT "workspace_invites_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "workspace_users" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"user_id" text NOT NULL,
	"time_zone" text DEFAULT 'America/Sao_Paulo' NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"role" text NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workspaces" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"currency" text DEFAULT 'BRL' NOT NULL,
	"time_zone" text DEFAULT 'America/Sao_Paulo' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "categories" ADD CONSTRAINT "categories_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "categories" ADD CONSTRAINT "categories_parent_id_categories_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_transactions" ADD CONSTRAINT "recurring_transactions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_transactions" ADD CONSTRAINT "recurring_transactions_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_transactions" ADD CONSTRAINT "recurring_transactions_destination_account_id_accounts_id_fk" FOREIGN KEY ("destination_account_id") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_transactions" ADD CONSTRAINT "recurring_transactions_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_recurring_transaction_id_recurring_transactions_id_fk" FOREIGN KEY ("recurring_transaction_id") REFERENCES "public"."recurring_transactions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_destination_account_id_accounts_id_fk" FOREIGN KEY ("destination_account_id") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_invites" ADD CONSTRAINT "workspace_invites_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_invites" ADD CONSTRAINT "workspace_invites_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_users" ADD CONSTRAINT "workspace_users_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_users" ADD CONSTRAINT "workspace_users_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_account_ws" ON "accounts" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "idx_account_type" ON "accounts" USING btree ("type");--> statement-breakpoint
CREATE INDEX "idx_account_closing_due" ON "accounts" USING btree ("closing_days_before_due","due_day");--> statement-breakpoint
CREATE UNIQUE INDEX "unq_cat_ws_name_type_parent" ON "categories" USING btree ("workspace_id","name","type","parent_id");--> statement-breakpoint
CREATE INDEX "idx_cat_ws_type" ON "categories" USING btree ("workspace_id","type");--> statement-breakpoint
CREATE INDEX "idx_cat_parent" ON "categories" USING btree ("parent_id");--> statement-breakpoint
CREATE INDEX "idx_cat_system" ON "categories" USING btree ("is_system_category");--> statement-breakpoint
CREATE INDEX "idx_recurring_active_start" ON "recurring_transactions" USING btree ("active","start_date");--> statement-breakpoint
CREATE INDEX "idx_recurring_workspace_active" ON "recurring_transactions" USING btree ("workspace_id","active");--> statement-breakpoint
CREATE INDEX "idx_recurring_last_generated" ON "recurring_transactions" USING btree ("last_generated");--> statement-breakpoint
CREATE INDEX "idx_refresh_token_user_id" ON "refresh_tokens" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_trans_ws_date_status_type" ON "transactions" USING btree ("workspace_id","date","status","type");--> statement-breakpoint
CREATE INDEX "idx_trans_account" ON "transactions" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "idx_trans_category_filter" ON "transactions" USING btree ("workspace_id","category_id","type","date");--> statement-breakpoint
CREATE INDEX "idx_trans_destination_account" ON "transactions" USING btree ("destination_account_id");--> statement-breakpoint
CREATE INDEX "idx_trans_installment_group" ON "transactions" USING btree ("installment_group_id");--> statement-breakpoint
CREATE INDEX "idx_invite_code" ON "workspace_invites" USING btree ("code");--> statement-breakpoint
CREATE INDEX "idx_invite_ws_expires" ON "workspace_invites" USING btree ("workspace_id","expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "unq_workspace_user" ON "workspace_users" USING btree ("workspace_id","user_id");--> statement-breakpoint
CREATE INDEX "idx_wu_user_default" ON "workspace_users" USING btree ("user_id","is_default");-- system categories with fixed IDs referenced by src/modules/category/constants/system-categories.ts
INSERT INTO "categories" ("id", "workspace_id", "name", "type", "is_system_category", "parent_id")
SELECT v.id, NULL, v.name, v.type, true, NULL
FROM (VALUES
    ('19323ba9-e496-4db9-9c22-b2a5c7cb790e', 'Transferência', 'TRANSFER'),
    ('0d19bbf8-b66a-4cc2-9c7c-3fcd961f06b1', 'Cartão de Crédito', 'EXPENSE')
  ) AS v(id, name, type)
WHERE NOT EXISTS (SELECT 1 FROM "categories" c WHERE c."id" = v.id);--> statement-breakpoint
-- 1b. Categorias genéricas usadas só como destino do backfill: não são
--     referenciadas pelo código, então o ID aleatório do seed serve.
INSERT INTO "categories" ("id", "workspace_id", "name", "type", "is_system_category", "parent_id")
SELECT gen_random_uuid()::text, NULL, v.name, v.type, true, NULL
FROM (VALUES
    ('Outros Ganhos', 'INCOME'),
    ('Outros Gastos', 'EXPENSE')
  ) AS v(name, type)
WHERE NOT EXISTS (
  SELECT 1 FROM "categories" c
  WHERE c."workspace_id" IS NULL
    AND c."is_system_category" = true
    AND c."parent_id" IS NULL
    AND c."name" = v.name
    AND c."type" = v.type
);--> statement-breakpoint
