-- Objetivo: auditar antes do deploy das migrations 0040 e 0041 (alinham o catálogo de FKs de produção, nascida no Prisma, com o schema do Drizzle): (1) FKs de accounts, categories, recurring_transactions, transactions, workspace_users, subscriptions e workspace_invites em pg_constraint, com conname, confdeltype, confupdtype e convalidated (a 0040 renomeia os onze nomes _fkey da era Prisma para o nome do Drizzle e adiciona recurring_transactions.category_id -> categories quando ausente; a 0041 só recria FKs cujo confdeltype ou confupdtype difere do schema); (2) recurring_transactions órfãs, com category_id preenchido e sem categoria correspondente (o ADD CONSTRAINT valida todas as linhas e a migration aborta com RAISE EXCEPTION se houver alguma); (3) volumes das tabelas, tamanho total de recurring_transactions (o ADD CONSTRAINT varre a tabela sob lock), versão do servidor e última migration aplicada. Rodar em produção antes do deploy e colar o resultado no PR. Somente leitura.
-- Esperado: (1) prod: os onze conname *_fkey, transactions.category_id com confdeltype r, nenhuma FK em recurring_transactions.category_id; fresh database: nomes do Drizzle e a FK presente; (2) orphan_recurring_transactions = 0; (3) baseline de volume e a última migration aplicada anterior à 0040.
BEGIN READ ONLY;

SELECT conrelid::regclass AS table_name, conname, confdeltype, confupdtype, convalidated
FROM pg_constraint
WHERE contype = 'f'
  AND conrelid IN (
    'public.accounts'::regclass,
    'public.categories'::regclass,
    'public.recurring_transactions'::regclass,
    'public.transactions'::regclass,
    'public.workspace_users'::regclass,
    'public.subscriptions'::regclass,
    'public.workspace_invites'::regclass
  )
ORDER BY conrelid::regclass::text, conname;

SELECT count(*) AS orphan_recurring_transactions
FROM recurring_transactions r
LEFT JOIN categories c ON c.id = r.category_id
WHERE r.category_id IS NOT NULL
  AND c.id IS NULL;

SELECT (SELECT count(*) FROM recurring_transactions) AS recurring_transactions_rows,
       (SELECT count(*) FROM categories) AS categories_rows,
       pg_total_relation_size('recurring_transactions') AS recurring_transactions_total_bytes,
       version() AS server_version;

SELECT id, hash, created_at
FROM drizzle.__drizzle_migrations
ORDER BY created_at DESC
LIMIT 1;

ROLLBACK;
