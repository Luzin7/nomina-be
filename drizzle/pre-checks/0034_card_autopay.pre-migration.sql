-- Objetivo: auditar antes do deploy da migration 0034 (autopay de fatura de cartão): cartões de crédito com due_day nulo ou fora de 1..28, closing_days_before_due fora de 5/7/10 e time_zone ausente de pg_timezone_names (o job de autopay julga vencimento e ativação na data local do cartão e calcula a fatura com esses três campos); e se as colunas auto_pay_* ou a tabela card_invoice_settlements já existem (a migration usa ADD COLUMN/CREATE TABLE sem IF NOT EXISTS e falha se existirem). Rodar em produção antes do deploy e corrigir as linhas retornadas. Somente leitura.
-- Esperado: cada seção com 0 linhas e todas as verificações de existência com exists = false.
BEGIN READ ONLY;

SELECT 'invalid_due_day' AS section, id::text AS ref, due_day::text AS value
FROM accounts
WHERE type = 'CREDIT_CARD'
  AND (due_day IS NULL OR due_day NOT BETWEEN 1 AND 28)
UNION ALL
SELECT 'invalid_closing_days_before_due', id::text, closing_days_before_due::text
FROM accounts
WHERE type = 'CREDIT_CARD'
  AND (closing_days_before_due IS NULL OR closing_days_before_due NOT IN (5, 7, 10))
UNION ALL
SELECT 'invalid_time_zone', id::text, time_zone
FROM accounts
WHERE type = 'CREDIT_CARD'
  AND (time_zone IS NULL OR time_zone NOT IN (SELECT name FROM pg_timezone_names))
ORDER BY section, ref;

SELECT 'column accounts.' || c.name AS object,
       EXISTS (
         SELECT 1 FROM information_schema.columns
         WHERE table_schema = 'public'
           AND table_name = 'accounts'
           AND column_name = c.name
       ) AS "exists"
FROM (VALUES
  ('auto_pay_enabled'),
  ('auto_pay_confirmed_at'),
  ('auto_pay_enabled_at'),
  ('auto_pay_source_account_id')
) AS c(name)
UNION ALL
SELECT 'table card_invoice_settlements',
       EXISTS (
         SELECT 1 FROM information_schema.tables
         WHERE table_schema = 'public'
           AND table_name = 'card_invoice_settlements'
       );

ROLLBACK;
