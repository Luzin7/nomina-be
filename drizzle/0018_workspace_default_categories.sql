DROP INDEX IF EXISTS "unq_cat_ws_name_type_parent";--> statement-breakpoint
DROP INDEX IF EXISTS "categories_workspace_id_name_type_parent_id_key";--> statement-breakpoint
DROP INDEX IF EXISTS "categories_system_unique";--> statement-breakpoint
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
  obsolete RECORD;
  ref RECORD;
  target_id TEXT;
  target_name TEXT;
  target_parent TEXT;
BEGIN
  CREATE TEMP TABLE _name_map (src TEXT PRIMARY KEY, tgt TEXT NOT NULL);

  INSERT INTO _name_map (src, tgt) VALUES
    ('Outros Ganhos', 'Outros');

  FOR obsolete IN
    SELECT c.id, c.name, c.type, c.parent_id
    FROM categories c
    WHERE c.workspace_id IS NULL
      AND (c.id LIKE 'cat\_%' OR c.name IN ('Outros Ganhos', 'Outros Gastos'))
    ORDER BY (SELECT count(*) FROM categories x WHERE x.parent_id = c.id) ASC, c.id
  LOOP
    SELECT m.tgt INTO target_name FROM _name_map m WHERE m.src = obsolete.name;

    IF target_name IS NULL THEN
      target_name := obsolete.name;
    END IF;

    target_parent := NULL;

    IF obsolete.parent_id IS NOT NULL THEN
      SELECT COALESCE(m.tgt, p.name) INTO target_parent
      FROM categories p
      LEFT JOIN _name_map m ON m.src = p.name
      WHERE p.id = obsolete.parent_id;
    END IF;

    FOR ref IN
      SELECT t.id, t.workspace_id FROM transactions t WHERE t.category_id = obsolete.id
    LOOP
      SELECT tgt.id INTO target_id
      FROM categories tgt
      LEFT JOIN categories tgt_parent ON tgt_parent.id = tgt.parent_id
      WHERE tgt.workspace_id = ref.workspace_id
        AND tgt.name = target_name
        AND tgt.type = obsolete.type
        AND ((target_parent IS NULL AND tgt.parent_id IS NULL) OR tgt_parent.name = target_parent)
      LIMIT 1;

      IF target_id IS NULL THEN
        RAISE EXCEPTION 'no % equivalent for obsolete category % (id %) referenced by transaction % in workspace %', obsolete.type, obsolete.name, obsolete.id, ref.id, ref.workspace_id;
      END IF;

      UPDATE transactions SET category_id = target_id WHERE id = ref.id;
    END LOOP;

    FOR ref IN
      SELECT r.id, r.workspace_id FROM recurring_transactions r WHERE r.category_id = obsolete.id
    LOOP
      SELECT tgt.id INTO target_id
      FROM categories tgt
      LEFT JOIN categories tgt_parent ON tgt_parent.id = tgt.parent_id
      WHERE tgt.workspace_id = ref.workspace_id
        AND tgt.name = target_name
        AND tgt.type = obsolete.type
        AND ((target_parent IS NULL AND tgt.parent_id IS NULL) OR tgt_parent.name = target_parent)
      LIMIT 1;

      IF target_id IS NULL THEN
        RAISE EXCEPTION 'no % equivalent for obsolete category % (id %) referenced by recurring transaction % in workspace %', obsolete.type, obsolete.name, obsolete.id, ref.id, ref.workspace_id;
      END IF;

      UPDATE recurring_transactions SET category_id = target_id WHERE id = ref.id;
    END LOOP;

    DELETE FROM categories WHERE id = obsolete.id;
  END LOOP;

  DROP TABLE _name_map;
END $$;
