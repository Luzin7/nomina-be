-- Objetivo: auditar antes do deploy da migration 0047 (goals.progress_source NOT NULL DEFAULT 'manual', dois CHECKs e índice único parcial). Somente leitura, agregados.
-- Esperado: server_major >= 11; total_goals = qualquer valor; linked_goals = qualquer valor; goals_total_size pequeno (a janela de lock é proporcional ao tamanho); ambos os CHECKs passam para todas as linhas porque toda linha existente nasce 'manual'. O índice único parcial tem predicado vazio.
SELECT
  current_setting('server_version_num')::int / 10000 AS server_major,
  count(*) AS total_goals,
  count(*) FILTER (WHERE linked_account_id IS NOT NULL) AS linked_goals,
  pg_size_pretty(pg_total_relation_size('goals')) AS goals_total_size
FROM goals;
