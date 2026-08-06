-- Idempotente de propósito: esta migration foi editada depois de já ter sido
-- aplicada em ambiente de desenvolvimento (para acrescentar a conversão do dado
-- que faltava), então o drizzle a verá com hash novo e tentará reaplicá-la.
-- Reaplicar precisa ser inofensivo.
ALTER TABLE "accounts" ADD COLUMN IF NOT EXISTS "closing_days_before_due" integer DEFAULT 7 NOT NULL;--> statement-breakpoint
-- Converte o dado existente antes de derrubar `closing_day`.
--
-- Modelo antigo: `closing_day` era o dia do mês em que a fatura fechava.
-- Modelo novo: `closing_days_before_due` é a distância, em dias, entre o
-- fechamento e o vencimento — restrita ao conjunto {5, 7, 10}.
--
-- O intervalo bruto é `due_day - closing_day`, com o módulo 30 cobrindo o caso
-- em que o fechamento cai no mês anterior ao do vencimento (ex.: fecha dia 25,
-- vence dia 5). O resultado é então encaixado na opção mais próxima.
--
-- Intervalo 0 (fechamento no mesmo dia do vencimento) é dado inconsistente e
-- cai no padrão 7, assim como contas sem `closing_day` ou `due_day`.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'accounts' AND column_name = 'closing_day'
  ) THEN
    EXECUTE $sql$
      UPDATE "accounts"
      SET "closing_days_before_due" = CASE
          WHEN ((("due_day" - "closing_day") % 30) + 30) % 30 BETWEEN 1 AND 5 THEN 5
          WHEN ((("due_day" - "closing_day") % 30) + 30) % 30 BETWEEN 6 AND 8 THEN 7
          WHEN ((("due_day" - "closing_day") % 30) + 30) % 30 >= 9 THEN 10
          ELSE 7
        END
      WHERE "type" = 'CREDIT_CARD'
        AND "closing_day" IS NOT NULL
        AND "due_day" IS NOT NULL
    $sql$;
  END IF;
END $$;--> statement-breakpoint
-- `due_day` passou a ser limitado a 1–28, para que todo mês do calendário tenha
-- o dia. Contas cadastradas com 29–31 são ajustadas para 28.
UPDATE "accounts"
SET "due_day" = 28
WHERE "type" = 'CREDIT_CARD' AND "due_day" > 28;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_account_ws" ON "accounts" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_account_type" ON "accounts" USING btree ("type");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_account_closing_due" ON "accounts" USING btree ("closing_days_before_due","due_day");--> statement-breakpoint
ALTER TABLE "accounts" DROP COLUMN IF EXISTS "closing_day";
