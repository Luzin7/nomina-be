-- Objetivo: auditar antes do deploy da migration 0043 (move para a meia-noite local do workspace as transactions legadas gravadas em 00:00 UTC, criadas antes de 2026-04-27). Um único SELECT somente leitura; o filtro das subconsultas é o mesmo da migration, sem o filtro de recorrência nas colunas que o inspecionam.
-- Esperado: matching_rows = 33 (a migration atualiza só as sem recorrência); matching_recurring = 0 (linhas com recurring_transaction_id são ignoradas pela migration; diferente de 0 exige revisão); matching_on_credit_card_accounts e matching_linked_to_recurring_suggestions informativos; non_sao_paulo_workspaces = 0; max_migration_created_at anterior à 0043.
SELECT
  (SELECT count(*)
     FROM transactions t
     JOIN workspaces w ON w.id = t.workspace_id
    WHERE t.recurring_transaction_id IS NULL
      AND t.created_at < '2026-04-27 00:00:00+00'
      AND (t.date AT TIME ZONE 'UTC')::time = '00:00:00'
      AND (t.date AT TIME ZONE w.time_zone)::time <> '00:00:00') AS matching_rows,
  (SELECT count(*)
     FROM transactions t
     JOIN workspaces w ON w.id = t.workspace_id
    WHERE t.recurring_transaction_id IS NOT NULL
      AND t.created_at < '2026-04-27 00:00:00+00'
      AND (t.date AT TIME ZONE 'UTC')::time = '00:00:00'
      AND (t.date AT TIME ZONE w.time_zone)::time <> '00:00:00') AS matching_recurring,
  (SELECT count(*)
     FROM transactions t
     JOIN workspaces w ON w.id = t.workspace_id
     JOIN accounts a ON a.id = t.account_id
    WHERE t.recurring_transaction_id IS NULL
      AND a.type = 'CREDIT_CARD'
      AND t.created_at < '2026-04-27 00:00:00+00'
      AND (t.date AT TIME ZONE 'UTC')::time = '00:00:00'
      AND (t.date AT TIME ZONE w.time_zone)::time <> '00:00:00') AS matching_on_credit_card_accounts,
  (SELECT count(*)
     FROM transactions t
     JOIN workspaces w ON w.id = t.workspace_id
     JOIN recurring_suggestion_transactions rst ON rst.transaction_id = t.id
    WHERE t.recurring_transaction_id IS NULL
      AND t.created_at < '2026-04-27 00:00:00+00'
      AND (t.date AT TIME ZONE 'UTC')::time = '00:00:00'
      AND (t.date AT TIME ZONE w.time_zone)::time <> '00:00:00') AS matching_linked_to_recurring_suggestions,
  (SELECT count(*) FROM workspaces WHERE time_zone <> 'America/Sao_Paulo') AS non_sao_paulo_workspaces,
  (SELECT max(created_at) FROM drizzle.__drizzle_migrations) AS max_migration_created_at;
