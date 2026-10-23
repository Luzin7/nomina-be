DO $$
DECLARE
  rule RECORD;
  legacy RECORD;
  child RECORD;
  target_id TEXT;
  compras_id TEXT;
  sibling_id TEXT;
  vestuario_target_id TEXT;
  affected INT;
  deleted_total INT := 0;
  transactions_total INT := 0;
  recurring_total INT := 0;
  children_moved INT := 0;
  children_merged INT := 0;
BEGIN
  FOR rule IN
    SELECT * FROM (VALUES
      ('Restaurantes', 'Alimentação', 'EXPENSE', 'Restaurante', 'Alimentação'),
      ('Streaming', 'Lazer', 'EXPENSE', 'Assinatura (streaming, academia)', 'Lazer'),
      ('Mensalidade', 'Educação', 'EXPENSE', 'Curso/Mensalidade', 'Educação'),
      ('Cursos', 'Educação', 'EXPENSE', 'Curso/Mensalidade', 'Educação'),
      ('Assinaturas', 'Serviços', 'EXPENSE', 'Assinatura (software)', 'Serviços'),
      ('Medicamentos', 'Saúde', 'EXPENSE', 'Farmácia', 'Saúde'),
      ('Energia', 'Moradia', 'EXPENSE', 'Luz', 'Moradia'),
      ('Materiais', 'Educação', 'EXPENSE', 'Material', 'Educação'),
      ('Freelance', NULL, 'INCOME', 'Freela/Projeto', NULL)
    ) AS rules(legacy_name, legacy_parent_name, type, target_name, target_parent_name)
  LOOP
    FOR legacy IN
      SELECT c.id, c.workspace_id
      FROM categories c
      LEFT JOIN categories p ON p.id = c.parent_id
      WHERE c.workspace_id IS NOT NULL
        AND c.is_system_category = false
        AND c.name = rule.legacy_name
        AND c.type = rule.type
        AND (
          (rule.legacy_parent_name IS NULL AND c.parent_id IS NULL)
          OR (p.name = rule.legacy_parent_name AND p.parent_id IS NULL)
        )
    LOOP
      SELECT t.id INTO target_id
      FROM categories t
      LEFT JOIN categories tp ON tp.id = t.parent_id
      WHERE t.workspace_id = legacy.workspace_id
        AND t.is_system_category = false
        AND t.id <> legacy.id
        AND t.name = rule.target_name
        AND t.type = rule.type
        AND (
          (rule.target_parent_name IS NULL AND t.parent_id IS NULL)
          OR (tp.name = rule.target_parent_name AND tp.parent_id IS NULL)
        )
      ORDER BY t.id
      LIMIT 1;

      IF target_id IS NULL THEN
        RAISE EXCEPTION 'missing target % for legacy category % in workspace %', rule.target_name, legacy.id, legacy.workspace_id;
      END IF;

      UPDATE transactions SET category_id = target_id WHERE category_id = legacy.id;
      GET DIAGNOSTICS affected = ROW_COUNT;
      transactions_total := transactions_total + affected;
      UPDATE recurring_transactions SET category_id = target_id WHERE category_id = legacy.id;
      GET DIAGNOSTICS affected = ROW_COUNT;
      recurring_total := recurring_total + affected;
      UPDATE categories SET parent_id = target_id WHERE parent_id = legacy.id;
      DELETE FROM categories WHERE id = legacy.id;
      GET DIAGNOSTICS affected = ROW_COUNT;
      deleted_total := deleted_total + affected;
    END LOOP;
  END LOOP;

  FOR legacy IN
    SELECT c.id, c.workspace_id
    FROM categories c
    WHERE c.workspace_id IS NOT NULL
      AND c.is_system_category = false
      AND c.name = 'Vestuário'
      AND c.type = 'EXPENSE'
      AND c.parent_id IS NULL
  LOOP
    SELECT c.id INTO compras_id
    FROM categories c
    WHERE c.workspace_id = legacy.workspace_id
      AND c.is_system_category = false
      AND c.name = 'Compras'
      AND c.type = 'EXPENSE'
      AND c.parent_id IS NULL
    ORDER BY c.id
    LIMIT 1;

    IF compras_id IS NULL THEN
      RAISE EXCEPTION 'missing Compras for legacy Vestuário % in workspace %', legacy.id, legacy.workspace_id;
    END IF;

    SELECT c.id INTO vestuario_target_id
    FROM categories c
    WHERE c.parent_id = compras_id
      AND c.name = 'Vestuário'
      AND c.type = 'EXPENSE';

    IF vestuario_target_id IS NULL THEN
      RAISE EXCEPTION 'missing Compras > Vestuário for legacy Vestuário % in workspace %', legacy.id, legacy.workspace_id;
    END IF;

    FOR child IN
      SELECT c.id, c.name, c.type FROM categories c WHERE c.parent_id = legacy.id
    LOOP
      SELECT s.id INTO sibling_id
      FROM categories s
      WHERE s.parent_id = compras_id
        AND s.name = child.name
        AND s.type = child.type;

      IF sibling_id IS NULL THEN
        UPDATE categories SET parent_id = compras_id WHERE id = child.id;
        children_moved := children_moved + 1;
        CONTINUE;
      END IF;

      UPDATE transactions SET category_id = sibling_id WHERE category_id = child.id;
      GET DIAGNOSTICS affected = ROW_COUNT;
      transactions_total := transactions_total + affected;
      UPDATE recurring_transactions SET category_id = sibling_id WHERE category_id = child.id;
      GET DIAGNOSTICS affected = ROW_COUNT;
      recurring_total := recurring_total + affected;
      UPDATE categories SET parent_id = sibling_id WHERE parent_id = child.id;
      DELETE FROM categories WHERE id = child.id;
      GET DIAGNOSTICS affected = ROW_COUNT;
      deleted_total := deleted_total + affected;
      children_merged := children_merged + 1;
    END LOOP;

    UPDATE transactions SET category_id = vestuario_target_id WHERE category_id = legacy.id;
    GET DIAGNOSTICS affected = ROW_COUNT;
    transactions_total := transactions_total + affected;
    UPDATE recurring_transactions SET category_id = vestuario_target_id WHERE category_id = legacy.id;
    GET DIAGNOSTICS affected = ROW_COUNT;
    recurring_total := recurring_total + affected;

    IF EXISTS (SELECT 1 FROM categories WHERE parent_id = legacy.id) THEN
      RAISE EXCEPTION 'legacy Vestuário % still has children in workspace %', legacy.id, legacy.workspace_id;
    END IF;

    DELETE FROM categories WHERE id = legacy.id;
    GET DIAGNOSTICS affected = ROW_COUNT;
    deleted_total := deleted_total + affected;
  END LOOP;

  RAISE NOTICE '0024 merge: deleted=%, tx=%, recurring=%, children_moved=%, children_merged=%', deleted_total, transactions_total, recurring_total, children_moved, children_merged;
END $$;--> statement-breakpoint
DO $$
DECLARE
  violations INT;
BEGIN
  SELECT count(*) INTO violations
  FROM categories c
  LEFT JOIN categories p ON p.id = c.parent_id
  WHERE c.workspace_id IS NOT NULL
    AND c.is_system_category = false
    AND (
      (c.name = 'Vestuário' AND c.type = 'EXPENSE' AND c.parent_id IS NULL)
      OR (c.name = 'Freelance' AND c.type = 'INCOME' AND c.parent_id IS NULL)
      OR (c.type = 'EXPENSE' AND p.parent_id IS NULL AND (
        (c.name = 'Restaurantes' AND p.name = 'Alimentação')
        OR (c.name = 'Streaming' AND p.name = 'Lazer')
        OR (c.name IN ('Mensalidade', 'Cursos', 'Materiais') AND p.name = 'Educação')
        OR (c.name = 'Assinaturas' AND p.name = 'Serviços')
        OR (c.name = 'Medicamentos' AND p.name = 'Saúde')
        OR (c.name = 'Energia' AND p.name = 'Moradia')
      ))
    );

  IF violations > 0 THEN
    RAISE EXCEPTION 'legacy categories remain after merge: %', violations;
  END IF;

  SELECT count(*) INTO violations
  FROM categories c
  JOIN categories p ON p.id = c.parent_id
  WHERE c.workspace_id IS NOT NULL
    AND p.parent_id IS NOT NULL;

  IF violations > 0 THEN
    RAISE EXCEPTION 'categories nested deeper than two levels: %', violations;
  END IF;

  SELECT count(*) INTO violations
  FROM (
    SELECT t.category_id, t.workspace_id FROM transactions t
    WHERE t.category_id IS NOT NULL
    UNION ALL
    SELECT r.category_id, r.workspace_id FROM recurring_transactions r
    WHERE r.category_id IS NOT NULL
  ) refs
  LEFT JOIN categories c ON c.id = refs.category_id
  WHERE c.id IS NULL
    OR (c.workspace_id IS NOT NULL AND c.workspace_id <> refs.workspace_id);

  IF violations > 0 THEN
    RAISE EXCEPTION 'dangling or cross-workspace category references: %', violations;
  END IF;

  SELECT count(*) INTO violations
  FROM (
    SELECT 1
    FROM categories c
    WHERE c.workspace_id IS NOT NULL
    GROUP BY c.workspace_id, c.name, c.type, COALESCE(c.parent_id, '')
    HAVING count(*) > 1
  ) duplicated;

  IF violations > 0 THEN
    RAISE EXCEPTION 'duplicate categories per workspace: %', violations;
  END IF;
END $$;
