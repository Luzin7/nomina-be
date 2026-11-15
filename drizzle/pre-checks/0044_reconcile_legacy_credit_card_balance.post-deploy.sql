-- Objetivo: PÓS-DEPLOY da migration 0044. Confere que o cartão corrigido não diverge mais do ledger e que o movimento RECONCILIATION foi gravado uma única vez. Somente leitura.
-- Esperado: drifting_credit_cards = 0 para o cartão corrigido (outros cartões com divergência são anteriores e não pertencem a esta migration); reconciliation_movements = 1; reconciliation_delta_cents = 124858.
SELECT
  (SELECT count(*)
     FROM accounts a
     CROSS JOIN LATERAL (
       SELECT COALESCE(SUM(
         CASE
           WHEN t.destination_account_id = a.id THEN -t.amount
           WHEN t.type = 'INCOME' THEN -t.amount
           ELSE t.amount
         END
       ), 0) AS ledger_sum
       FROM transactions t
       WHERE t.workspace_id = a.workspace_id
         AND t.status = 'COMPLETED'
         AND (t.account_id = a.id OR t.destination_account_id = a.id)
     ) l
    WHERE a.type = 'CREDIT_CARD'
      AND l.ledger_sum <> a.balance) AS drifting_credit_cards,
  (SELECT count(*) FROM balance_movements WHERE cause = 'RECONCILIATION' AND delta = 124858) AS reconciliation_movements,
  (SELECT COALESCE(sum(delta), 0) FROM balance_movements WHERE cause = 'RECONCILIATION' AND delta = 124858) AS reconciliation_delta_cents;
