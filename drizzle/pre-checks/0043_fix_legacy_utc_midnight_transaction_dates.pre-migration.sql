-- Objetivo: auditar antes do deploy da migration 0043 (move para a meia-noite local do workspace as transactions legadas gravadas em 00:00 UTC, criadas antes de 2026-04-27, quando os escritores passaram a usar startOfDay com o fuso do workspace): (1) quantas linhas a migration atualizará e o intervalo de created_at e date delas; (2) workspaces cujo fuso não é America/Sao_Paulo e quantas linhas afetadas cada um tem; (3) TimeZone do servidor e última migration aplicada. Somente leitura; cada comando é independente.
-- Esperado: (1) matching_rows = 33, created_at_max anterior a 2026-04-27; (2) zero linhas (todo workspace em America/Sao_Paulo); (3) qualquer TimeZone (a migration não depende dele) e a última migration anterior à 0043.
SELECT count(*) AS matching_rows,
       min(t.created_at) AS created_at_min,
       max(t.created_at) AS created_at_max,
       min(t.date) AS date_min,
       max(t.date) AS date_max
FROM transactions t
JOIN workspaces w ON w.id = t.workspace_id
WHERE t.created_at < '2026-04-27 00:00:00+00'
  AND (t.date AT TIME ZONE 'UTC')::time = '00:00:00'
  AND (t.date AT TIME ZONE w.time_zone)::time <> '00:00:00';

SELECT w.id AS workspace_id, w.time_zone, count(t.id) AS matching_rows
FROM workspaces w
LEFT JOIN transactions t
  ON t.workspace_id = w.id
 AND t.created_at < '2026-04-27 00:00:00+00'
 AND (t.date AT TIME ZONE 'UTC')::time = '00:00:00'
WHERE w.time_zone <> 'America/Sao_Paulo'
GROUP BY w.id, w.time_zone
ORDER BY w.id;

SELECT current_setting('TimeZone') AS db_timezone,
       (SELECT id FROM drizzle.__drizzle_migrations ORDER BY created_at DESC LIMIT 1) AS last_migration_id;
