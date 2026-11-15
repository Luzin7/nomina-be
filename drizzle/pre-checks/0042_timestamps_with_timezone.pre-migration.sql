-- Objetivo: auditar antes do deploy da migration 0042 (converte para timestamptz, interpretando o valor armazenado como UTC, as colunas que a era Prisma deixou como timestamp without time zone): (1) tipo e precisão atuais das 13 colunas alvo em information_schema; (2) views, views materializadas e colunas geradas que dependem dessas colunas (o ALTER COLUMN TYPE falha se uma view depender da coluna); (3) todos os índices das 7 tabelas afetadas, para achar índices de expressão que o ALTER possa quebrar; (4) sanidade UTC: linhas com created_at no futuro em relação a now() em UTC (esperado 0); (5) impressão digital de transactions (contagem e md5 de id mais date) para comparar antes e depois, com a consulta equivalente em 0042_timestamps_with_timezone.post-deploy.sql; (6) volumes por tabela, tamanho total (o ALTER reescreve a tabela e reconstrói os índices sob ACCESS EXCLUSIVE lock), min e max de transactions.date, TimeZone do servidor, versão e última migration aplicada. Rodar em produção antes do deploy e colar o resultado no PR. Somente leitura; cada comando é independente, pode ser executado um a um no editor SQL.
-- Esperado: (1) prod: timestamp without time zone, precisão 3 nas 13 colunas; fresh database: timestamp with time zone, precisão 6; (2) zero linhas; (3) apenas índices btree simples sobre colunas, sem expressões sobre as colunas alvo; (4) as três contagens = 0; (5) count e md5 anotados para comparar após o deploy; (6) TimeZone = GMT (a conversão assume UTC), min e max de transactions.date plausíveis, baseline de volume e a última migration aplicada anterior à 0042.
SELECT table_name, column_name, data_type, datetime_precision, column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND (table_name, column_name) IN (
    ('recurring_transactions', 'end_date'),
    ('recurring_transactions', 'last_generated'),
    ('recurring_transactions', 'start_date'),
    ('subscriptions', 'current_period_end'),
    ('transactions', 'created_at'),
    ('transactions', 'date'),
    ('transactions', 'updated_at'),
    ('users', 'created_at'),
    ('users', 'updated_at'),
    ('workspace_invites', 'expires_at'),
    ('workspace_invites', 'used_at'),
    ('workspace_users', 'joined_at'),
    ('workspaces', 'created_at')
  )
ORDER BY table_name, column_name;

SELECT DISTINCT v.schemaname, v.viewname
FROM pg_views v
JOIN pg_depend d ON d.refobjid IN (
  SELECT oid FROM pg_class
  WHERE relname IN ('recurring_transactions', 'subscriptions', 'transactions', 'users', 'workspace_invites', 'workspace_users', 'workspaces')
    AND relnamespace = 'public'::regnamespace
)
JOIN pg_rewrite r ON r.oid = d.objid
JOIN pg_class vc ON vc.oid = r.ev_class AND vc.relname = v.viewname AND vc.relnamespace = v.schemaname::regnamespace
WHERE v.schemaname = 'public'
UNION
SELECT schemaname, matviewname FROM pg_matviews WHERE schemaname = 'public';

SELECT table_name, column_name
FROM information_schema.columns
WHERE table_schema = 'public'
  AND is_generated = 'ALWAYS';

SELECT tablename, indexname, indexdef
FROM pg_indexes
WHERE schemaname = 'public'
  AND tablename IN ('recurring_transactions', 'subscriptions', 'transactions', 'users', 'workspace_invites', 'workspace_users', 'workspaces')
ORDER BY tablename, indexname;

SELECT (SELECT count(*) FROM transactions WHERE created_at > now() AT TIME ZONE 'UTC') AS transactions_future_created_at,
       (SELECT count(*) FROM users WHERE created_at > now() AT TIME ZONE 'UTC') AS users_future_created_at,
       (SELECT count(*) FROM workspaces WHERE created_at > now() AT TIME ZONE 'UTC') AS workspaces_future_created_at;

SELECT count(*) AS transactions_rows,
       md5(string_agg(id || to_char(date, 'YYYY-MM-DD HH24:MI:SS.MS'), ',' ORDER BY id)) AS transactions_fingerprint
FROM transactions;

SELECT (SELECT count(*) FROM transactions) AS transactions_rows,
       (SELECT count(*) FROM recurring_transactions) AS recurring_transactions_rows,
       (SELECT count(*) FROM users) AS users_rows,
       (SELECT count(*) FROM workspaces) AS workspaces_rows,
       (SELECT count(*) FROM workspace_users) AS workspace_users_rows,
       (SELECT count(*) FROM workspace_invites) AS workspace_invites_rows,
       (SELECT count(*) FROM subscriptions) AS subscriptions_rows,
       pg_total_relation_size('transactions') AS transactions_total_bytes,
       (SELECT min(date) FROM transactions) AS transactions_date_min,
       (SELECT max(date) FROM transactions) AS transactions_date_max,
       current_setting('TimeZone') AS db_timezone,
       version() AS server_version;

SELECT id, hash, created_at
FROM drizzle.__drizzle_migrations
ORDER BY created_at DESC
LIMIT 1;
