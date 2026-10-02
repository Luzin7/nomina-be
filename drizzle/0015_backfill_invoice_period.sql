-- Backfill de invoice_period_month/year para pagamentos de fatura legados.
-- Espelha a regra de domínio InvoiceAllocation.allocateInvoice: a fatura de
-- destino é a fechada mais recente na data do pagamento — ou seja, a última
-- data de vencimento (dia due_day, limitado ao tamanho do mês) que é menor ou
-- igual a (data do pagamento + closing_days_before_due), no fuso do cartão.
-- Só toca linhas com destino em cartão e período ainda nulo; idempotente.
WITH credit_card AS (
  SELECT
    id,
    due_day,
    closing_days_before_due,
    time_zone
  FROM accounts
  WHERE type = 'CREDIT_CARD' AND due_day IS NOT NULL
),
untagged AS (
  SELECT
    t.id AS transaction_id,
    (t.date AT TIME ZONE c.time_zone)::date + c.closing_days_before_due AS reference,
    c.due_day
  FROM transactions t
  JOIN credit_card c ON c.id = t.destination_account_id
  WHERE t.invoice_period_month IS NULL
    AND t.invoice_period_year IS NULL
),
resolved AS (
  SELECT
    transaction_id,
    CASE
      WHEN (
        date_trunc('month', reference)::date
        + (
          LEAST(
            due_day,
            (EXTRACT(DAY FROM date_trunc('month', reference) + interval '1 month - 1 day'))::int
          ) - 1
        ) * interval '1 day'
      )::date <= reference
        THEN date_trunc('month', reference)::date
      ELSE (date_trunc('month', reference) - interval '1 month')::date
    END AS invoice_month
  FROM untagged
)
UPDATE transactions t
SET
  invoice_period_month = EXTRACT(MONTH FROM r.invoice_month)::int,
  invoice_period_year = EXTRACT(YEAR FROM r.invoice_month)::int
FROM resolved r
WHERE t.id = r.transaction_id;
