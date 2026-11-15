-- Objetivo: PÓS-DEPLOY da migration 0043. Confere que nenhuma transaction legada continua em 00:00 UTC fora da meia-noite local e quantas transactions estão na meia-noite local do workspace. Somente leitura.
-- Esperado: legacy_matching_rows = 0; local_midnight_rows próximo de transactions_rows (678 na auditoria; linhas novas e linhas com horário real fora da meia-noite local não entram na contagem).
SELECT count(*) AS transactions_rows,
       count(*) FILTER (
         WHERE t.created_at < '2026-04-27 00:00:00+00'
           AND (t.date AT TIME ZONE 'UTC')::time = '00:00:00'
           AND (t.date AT TIME ZONE w.time_zone)::time <> '00:00:00'
       ) AS legacy_matching_rows,
       count(*) FILTER (WHERE (t.date AT TIME ZONE w.time_zone)::time = '00:00:00') AS local_midnight_rows
FROM transactions t
JOIN workspaces w ON w.id = t.workspace_id;
