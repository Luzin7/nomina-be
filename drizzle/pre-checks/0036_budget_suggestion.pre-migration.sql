-- Objetivo: auditar antes do deploy das migrations 0036/0037 (sugestão de orçamento). Informativo, nenhuma linha precisa ser corrigida: (1) workspaces sem snapshot de orçamento; (2) desses, quantos têm ao menos 3 meses-base (mês fechado no fuso do workspace, nos 12 meses anteriores ao mês corrente, com pelo menos 5 dias com despesa simples: COMPLETED, sem recorrência, sem parcelamento, categoria não-sistema); (3) nomes distintos de categorias-raiz EXPENSE com gasto que não estão no mapa seed de budget_category_groups (fora do mapa, essas categorias mantêm o gasto atual). Também verifica se as tabelas budget_* já existem (a migration usa CREATE TABLE sem IF NOT EXISTS e falha se existirem). Rodar em produção antes do deploy e colar o resultado no PR. Somente leitura.
-- Esperado: todas as verificações de existência com exists = false; as três contagens servem de baseline de impacto.
BEGIN READ ONLY;

SELECT 'table ' || t.name AS object,
       EXISTS (
         SELECT 1 FROM information_schema.tables
         WHERE table_schema = 'public' AND table_name = t.name
       ) AS "exists"
FROM (VALUES
  ('budget_parameters'),
  ('budget_income_brackets'),
  ('budget_category_groups'),
  ('budget_suggestion_decisions')
) AS t(name);

WITH workspaces_without_snapshot AS (
  SELECT w.id, w.time_zone
  FROM workspaces w
  WHERE NOT EXISTS (SELECT 1 FROM budgets b WHERE b.workspace_id = w.id)
),
plain_expense_days AS (
  SELECT s.id AS workspace_id,
         (t.date AT TIME ZONE s.time_zone)::date AS local_day
  FROM workspaces_without_snapshot s
  JOIN transactions t ON t.workspace_id = s.id
  JOIN categories c ON c.id = t.category_id
  WHERE t.type = 'EXPENSE'
    AND t.status = 'COMPLETED'
    AND t.recurring_transaction_id IS NULL
    AND t.installment_group_id IS NULL
    AND c.is_system_category = false
  GROUP BY s.id, (t.date AT TIME ZONE s.time_zone)::date
),
basis_months AS (
  SELECT d.workspace_id, date_trunc('month', d.local_day) AS month_start
  FROM plain_expense_days d
  JOIN workspaces_without_snapshot s ON s.id = d.workspace_id
  WHERE d.local_day >= date_trunc('month', (now() AT TIME ZONE s.time_zone)::date) - interval '12 months'
    AND d.local_day < date_trunc('month', (now() AT TIME ZONE s.time_zone)::date)
  GROUP BY d.workspace_id, date_trunc('month', d.local_day)
  HAVING count(*) >= 5
)
SELECT 'workspaces_without_snapshot' AS metric,
       (SELECT count(*) FROM workspaces_without_snapshot) AS value
UNION ALL
SELECT 'workspaces_without_snapshot_with_3_basis_months',
       (SELECT count(*) FROM workspaces_without_snapshot s
        WHERE (SELECT count(*) FROM basis_months m WHERE m.workspace_id = s.id) >= 3);

SELECT 'unmapped_root_expense_category' AS section, c.name AS ref, count(DISTINCT c.workspace_id)::text AS value
FROM categories c
JOIN categories leaf ON COALESCE(leaf.parent_id, leaf.id) = c.id
JOIN transactions t ON t.category_id = leaf.id
WHERE c.type = 'EXPENSE'
  AND c.parent_id IS NULL
  AND t.type = 'EXPENSE'
  AND t.status = 'COMPLETED'
  AND c.name NOT IN (
    'Moradia', 'Aluguel', 'Condomínio', 'Água', 'Luz', 'Internet', 'Alimentação', 'Mercado',
    'Transporte', 'Combustível', 'Transporte Público', 'Estacionamento', 'Saúde', 'Farmácia',
    'Plano de Saúde', 'Seguro', 'Serviços', 'Educação', 'Material', 'Impostos',
    'Lazer', 'Restaurante', 'Delivery', 'Viagem', 'Compras', 'Vestuário', 'Outros Gastos',
    'Investimentos'
  )
GROUP BY c.name
ORDER BY count(DISTINCT c.workspace_id) DESC, c.name;

ROLLBACK;
