-- Objetivo: auditar antes do deploy da migration 0044 (soma 124858 centavos ao saldo do cartão de crédito cujo saldo está exatamente 124858 abaixo do ledger de transactions COMPLETED e registra um movimento RECONCILIATION). Um único SELECT somente leitura; o filtro é o mesmo da migration.
-- Esperado: matching_cards = 1; qualquer outro valor significa que a migration não corrige o cartão esperado (ou corrige mais de um) e exige revisão.
SELECT count(*) AS matching_cards
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
  AND l.ledger_sum - a.balance = 124858
  AND NOT EXISTS (
    SELECT 1 FROM balance_movements m
    WHERE m.account_id = a.id AND m.cause = 'RECONCILIATION'
  );
