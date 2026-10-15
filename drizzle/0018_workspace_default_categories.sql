DROP INDEX IF EXISTS "unq_cat_ws_name_type_parent";--> statement-breakpoint
DROP INDEX IF EXISTS "categories_workspace_id_name_type_parent_id_key";--> statement-breakpoint
DROP INDEX IF EXISTS "categories_system_unique";--> statement-breakpoint
DROP INDEX IF EXISTS "unq_cat_sys_name_type_parent";--> statement-breakpoint
CREATE UNIQUE INDEX "unq_cat_sys_name_type_parent" ON "categories" USING btree ("name","type","parent_id") WHERE "categories"."workspace_id" IS NULL AND "categories"."is_system_category" = true;--> statement-breakpoint
CREATE UNIQUE INDEX "unq_cat_ws_name_type_parent" ON "categories" USING btree ("workspace_id","name","type","parent_id") WHERE "categories"."workspace_id" IS NOT NULL;--> statement-breakpoint
DO $$
DECLARE
  ws RECORD;
  node RECORD;
  existing_parent_id TEXT;
  existing_id TEXT;
BEGIN
  FOR ws IN
    SELECT w.id AS workspace_id FROM workspaces w
  LOOP
    FOR node IN
      SELECT * FROM (VALUES
        ('Alimentação', 'EXPENSE', NULL),
        ('Mercado', 'EXPENSE', 'Alimentação'),
        ('Restaurante', 'EXPENSE', 'Alimentação'),
        ('Delivery', 'EXPENSE', 'Alimentação'),
        ('Transporte', 'EXPENSE', NULL),
        ('Combustível', 'EXPENSE', 'Transporte'),
        ('Estacionamento', 'EXPENSE', 'Transporte'),
        ('Transporte Público', 'EXPENSE', 'Transporte'),
        ('Moradia', 'EXPENSE', NULL),
        ('Aluguel', 'EXPENSE', 'Moradia'),
        ('Condomínio', 'EXPENSE', 'Moradia'),
        ('Água', 'EXPENSE', 'Moradia'),
        ('Luz', 'EXPENSE', 'Moradia'),
        ('Internet', 'EXPENSE', 'Moradia'),
        ('Saúde', 'EXPENSE', NULL),
        ('Plano de Saúde', 'EXPENSE', 'Saúde'),
        ('Farmácia', 'EXPENSE', 'Saúde'),
        ('Consulta/Exame', 'EXPENSE', 'Saúde'),
        ('Educação', 'EXPENSE', NULL),
        ('Curso/Mensalidade', 'EXPENSE', 'Educação'),
        ('Material', 'EXPENSE', 'Educação'),
        ('Lazer', 'EXPENSE', NULL),
        ('Assinatura (streaming, academia)', 'EXPENSE', 'Lazer'),
        ('Viagem', 'EXPENSE', 'Lazer'),
        ('Saída (bar, cinema, show)', 'EXPENSE', 'Lazer'),
        ('Serviços', 'EXPENSE', NULL),
        ('Assinatura (software)', 'EXPENSE', 'Serviços'),
        ('Seguro', 'EXPENSE', 'Serviços'),
        ('Compras', 'EXPENSE', NULL),
        ('Vestuário', 'EXPENSE', 'Compras'),
        ('Impostos', 'EXPENSE', NULL),
        ('Outros Gastos', 'EXPENSE', NULL),
        ('Salário', 'INCOME', NULL),
        ('Investimentos', 'INCOME', NULL),
        ('Freela/Projeto', 'INCOME', NULL),
        ('Presente', 'INCOME', NULL),
        ('Outros', 'INCOME', NULL)
      ) AS tree(name, type, parent_name)
    LOOP
      existing_parent_id := NULL;

      IF node.parent_name IS NOT NULL THEN
        SELECT c.id INTO existing_parent_id
        FROM categories c
        WHERE c.workspace_id = ws.workspace_id
          AND c.name = node.parent_name
          AND c.parent_id IS NULL
        LIMIT 1;

        IF existing_parent_id IS NULL THEN
          RAISE EXCEPTION 'missing parent % for % in workspace %', node.parent_name, node.name, ws.workspace_id;
        END IF;
      END IF;

      SELECT c.id INTO existing_id
      FROM categories c
      WHERE c.workspace_id = ws.workspace_id
        AND c.name = node.name
        AND c.type = node.type
        AND c.parent_id IS NOT DISTINCT FROM existing_parent_id
      LIMIT 1;

      IF existing_id IS NULL THEN
        INSERT INTO categories (id, workspace_id, name, type, is_system_category, parent_id)
        VALUES (gen_random_uuid()::text, ws.workspace_id, node.name, node.type, false, existing_parent_id);
      END IF;
    END LOOP;
  END LOOP;
END $$;--> statement-breakpoint
DO $$
DECLARE
  sys_ids TEXT[] := ARRAY[
    '19323ba9-e496-4db9-9c22-b2a5c7cb790e',
    '0d19bbf8-b66a-4cc2-9c7c-3fcd961f06b1'
  ];
  pair RECORD;
  node_type TEXT;
  legacy_parent TEXT;
  target_name TEXT;
  parent_target TEXT;
  target_id TEXT;
  leftover INT;
BEGIN
  -- Every global that is referenced (transaction or recurring) or is an
  -- ancestor of a referenced global must get a per-workspace equivalent in
  -- each referencing workspace. Materialise those (legacy, workspace) pairs.
  DROP TABLE IF EXISTS _legacy_pairs;
  CREATE TEMP TABLE _legacy_pairs (
    legacy_id TEXT,
    ws_id TEXT,
    PRIMARY KEY (legacy_id, ws_id)
  );

  INSERT INTO _legacy_pairs (legacy_id, ws_id)
  WITH RECURSIVE pairs AS (
    SELECT c.id AS legacy_id, w.workspace_id AS ws_id
    FROM categories c
    JOIN (
      SELECT category_id, workspace_id FROM transactions
      UNION
      SELECT category_id, workspace_id FROM recurring_transactions
    ) w ON w.category_id = c.id
    WHERE c.workspace_id IS NULL
      AND c.id <> ALL(sys_ids)
    UNION
    SELECT p.id, pairs.ws_id
    FROM pairs
    JOIN categories c ON c.id = pairs.legacy_id
    JOIN categories p ON p.id = c.parent_id
    WHERE p.workspace_id IS NULL
      AND p.id <> ALL(sys_ids)
  )
  SELECT DISTINCT legacy_id, ws_id FROM pairs;

  -- Depth of every legacy node within the referenced/ancestor subgraph, so
  -- parents are mirrored before their children.
  DROP TABLE IF EXISTS _legacy_depth;
  CREATE TEMP TABLE _legacy_depth (legacy_id TEXT PRIMARY KEY, depth INT NOT NULL);

  INSERT INTO _legacy_depth (legacy_id, depth)
  WITH RECURSIVE depth AS (
    SELECT lp.legacy_id, 0 AS depth
    FROM (SELECT DISTINCT legacy_id FROM _legacy_pairs) lp
    WHERE NOT EXISTS (
      SELECT 1
      FROM categories p
      JOIN (SELECT DISTINCT legacy_id FROM _legacy_pairs) lp2 ON lp2.legacy_id = p.id
      WHERE p.id = (SELECT c.parent_id FROM categories c WHERE c.id = lp.legacy_id)
    )
    UNION ALL
    SELECT c.id, depth.depth + 1
    FROM depth
    JOIN categories c ON c.parent_id = depth.legacy_id
    JOIN (SELECT DISTINCT legacy_id FROM _legacy_pairs) lp ON lp.legacy_id = c.id
  )
  SELECT DISTINCT legacy_id, depth FROM depth;

  -- Mirror: for each pair, reuse a category with identical
  -- (workspace_id, name, type, resolved parent) or insert a fresh one.
  DROP TABLE IF EXISTS _mirror;
  CREATE TEMP TABLE _mirror (
    legacy_id TEXT,
    ws_id TEXT,
    new_id TEXT NOT NULL,
    PRIMARY KEY (legacy_id, ws_id)
  );

  FOR pair IN
    SELECT lp.legacy_id, lp.ws_id
    FROM _legacy_pairs lp
    JOIN _legacy_depth d ON d.legacy_id = lp.legacy_id
    ORDER BY d.depth ASC, lp.legacy_id, lp.ws_id
  LOOP
    SELECT CASE WHEN c.name = 'Outros Ganhos' THEN 'Outros' ELSE c.name END,
           c.type,
           c.parent_id
      INTO target_name, node_type, legacy_parent
    FROM categories c
    WHERE c.id = pair.legacy_id;

    parent_target := NULL;

    IF legacy_parent IS NOT NULL THEN
      SELECT m.new_id INTO parent_target
      FROM _mirror m
      WHERE m.legacy_id = legacy_parent
        AND m.ws_id = pair.ws_id;

      IF parent_target IS NULL THEN
        RAISE EXCEPTION 'missing mirrored parent % for legacy category % in workspace %', legacy_parent, pair.legacy_id, pair.ws_id;
      END IF;
    END IF;

    SELECT c.id INTO target_id
    FROM categories c
    WHERE c.workspace_id = pair.ws_id
      AND c.name = target_name
      AND c.type = node_type
      AND c.parent_id IS NOT DISTINCT FROM parent_target
    LIMIT 1;

    IF target_id IS NULL THEN
      target_id := gen_random_uuid()::text;

      INSERT INTO categories (id, workspace_id, name, type, is_system_category, parent_id)
      VALUES (target_id, pair.ws_id, target_name, node_type, false, parent_target);
    END IF;

    INSERT INTO _mirror (legacy_id, ws_id, new_id)
    VALUES (pair.legacy_id, pair.ws_id, target_id);
  END LOOP;

  -- Remap every reference off the non-system globals.
  UPDATE transactions t
  SET category_id = m.new_id
  FROM _mirror m
  WHERE t.category_id = m.legacy_id
    AND t.workspace_id = m.ws_id;

  UPDATE recurring_transactions r
  SET category_id = m.new_id
  FROM _mirror m
  WHERE r.category_id = m.legacy_id
    AND r.workspace_id = m.ws_id;

  SELECT count(*) INTO leftover
  FROM (
    SELECT category_id FROM transactions
    UNION ALL
    SELECT category_id FROM recurring_transactions
  ) refs
  JOIN categories c ON c.id = refs.category_id
  WHERE c.workspace_id IS NULL
    AND c.id <> ALL(sys_ids);

  IF leftover > 0 THEN
    RAISE EXCEPTION 'unresolved references to non-system global categories: %', leftover;
  END IF;

  -- Delete all globals except the 2 fixed system ids, leaf-first so the
  -- parent_id foreign key stays satisfied.
  LOOP
    DELETE FROM categories c
    WHERE c.workspace_id IS NULL
      AND c.id <> ALL(sys_ids)
      AND NOT EXISTS (
        SELECT 1
        FROM categories child
        WHERE child.parent_id = c.id
          AND child.workspace_id IS NULL
          AND child.id <> ALL(sys_ids)
      );

    EXIT WHEN NOT FOUND;
  END LOOP;

  DROP TABLE _mirror;
  DROP TABLE _legacy_depth;
  DROP TABLE _legacy_pairs;
END $$;
