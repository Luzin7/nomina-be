-- Objetivo: listar os grupos duplicados de (workspace_id, name, type, parent_id) que impedem a criação do índice unq_cat_ws_name_type_parent com NULLS NOT DISTINCT pela migration 0028; parent_id NULL entra no grupo (GROUP BY trata NULLs como iguais, assim como o índice). Linhas de sistema (workspace_id NULL) também entram. Rodar em produção antes do deploy e resolver as linhas retornadas. Somente leitura.
-- Esperado: 0 linhas. Medido em produção (somente leitura, 2026-11-09): categories 599 linhas, workspaces 15, 0 grupos duplicados em qualquer nível, 0 linhas Investimentos/EXPENSE existentes, 0 workspaces já com a categoria.
BEGIN READ ONLY;

SELECT
  workspace_id,
  name,
  type,
  parent_id,
  COUNT(*) AS duplicate_count,
  array_agg(id ORDER BY id) AS category_ids
FROM categories
GROUP BY workspace_id, name, type, parent_id
HAVING COUNT(*) > 1
ORDER BY duplicate_count DESC, workspace_id, name, type;

ROLLBACK;
