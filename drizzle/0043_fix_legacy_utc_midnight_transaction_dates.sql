UPDATE transactions t
SET date = ((t.date AT TIME ZONE 'UTC')::date)::timestamp AT TIME ZONE w.time_zone
FROM workspaces w
WHERE w.id = t.workspace_id
  AND t.created_at < '2026-04-27 00:00:00+00'
  AND (t.date AT TIME ZONE 'UTC')::time = '00:00:00'
  AND (t.date AT TIME ZONE w.time_zone)::time <> '00:00:00';
