-- Objetivo: PÓS-DEPLOY da migration 0042. Impressão digital de transactions para comparar com a consulta (5) do arquivo 0042_timestamps_with_timezone.pre-migration.sql: date AT TIME ZONE 'UTC' devolve o horário UTC como timestamp sem fuso, no mesmo formato da consulta pré-deploy. Somente leitura.
-- Esperado: count e md5 idênticos aos anotados antes do deploy.
SELECT count(*) AS transactions_rows,
       md5(string_agg(id || to_char(date AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS.MS'), ',' ORDER BY id)) AS transactions_fingerprint
FROM transactions;
