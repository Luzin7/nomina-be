-- Objetivo: listar os grupos duplicados de (recurring_transaction_id, date) que impedem a criação do índice ux_transactions_recurring_date pela migration 0019; rodar em produção antes do deploy e resolver as linhas retornadas.
SELECT
  recurring_transaction_id,
  date,
  COUNT(*) AS duplicate_count,
  array_agg(id ORDER BY created_at) AS transaction_ids
FROM transactions
WHERE recurring_transaction_id IS NOT NULL
GROUP BY recurring_transaction_id, date
HAVING COUNT(*) > 1
ORDER BY duplicate_count DESC, date DESC;
