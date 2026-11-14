-- Objetivo: auditar antes do deploy da migration 0038 (FK transactions.recurring_transaction_id passa a ON DELETE SET NULL): (1) estado atual da FK transactions -> recurring_transactions em pg_constraint (a migration faz DROP CONSTRAINT e ADD CONSTRAINT com esse nome); (2) transações órfãs, com recurring_transaction_id preenchido e sem regra correspondente (o ADD CONSTRAINT valida todas as linhas e falharia); (3) volumes das duas tabelas, tamanho total de transactions (o ADD CONSTRAINT varre a tabela sob lock), versão do servidor e última migration aplicada. Rodar em produção antes do deploy e colar o resultado no PR. Somente leitura.
-- Esperado: (1) 1 linha com confdeltype = 'a' (NO ACTION) e convalidated = true; (2) orphan_transactions = 0; (3) baseline de volume e a última migration aplicada anterior à 0038.
BEGIN READ ONLY;

SELECT conname, confdeltype, convalidated
FROM pg_constraint
WHERE contype = 'f'
  AND conrelid = 'public.transactions'::regclass
  AND confrelid = 'public.recurring_transactions'::regclass;

SELECT count(*) AS orphan_transactions
FROM transactions t
WHERE t.recurring_transaction_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM recurring_transactions r WHERE r.id = t.recurring_transaction_id
  );

SELECT (SELECT count(*) FROM transactions) AS transactions_rows,
       (SELECT count(*) FROM recurring_transactions) AS recurring_transactions_rows,
       pg_total_relation_size('transactions') AS transactions_total_bytes,
       version() AS server_version;

SELECT id, hash, created_at
FROM drizzle.__drizzle_migrations
ORDER BY created_at DESC
LIMIT 1;

ROLLBACK;
