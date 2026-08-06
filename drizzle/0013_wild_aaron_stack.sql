-- `category_id` passa a ser obrigatório. Qualquer banco com histórico tem linhas
-- anteriores a essa regra com NULL, e o `SET NOT NULL` falharia em cima delas —
-- então o backfill precisa vir antes.
--
-- Esta migration também é o que sustenta os IDs fixos de
-- `src/modules/category/constants/system-categories.ts`: ela garante que as
-- categorias de sistema existam com aqueles IDs exatos, para que o código possa
-- referenciá-los direto, sem consultar o banco. Tudo aqui é idempotente.

-- 1. Garante as categorias de ID fixo. A existência é checada pelo **ID**, não
--    pelo nome: num banco onde o seed já criou `Transferência` com um UUID
--    aleatório, a linha canônica precisa passar a existir para que o passo 2
--    consiga repontar os filhos para ela antes de apagar a duplicata.
INSERT INTO "categories" ("id", "workspace_id", "name", "type", "is_system_category", "parent_id")
SELECT v.id, NULL, v.name, v.type, true, NULL
FROM (VALUES
    ('19323ba9-e496-4db9-9c22-b2a5c7cb790e', 'Transferência', 'TRANSFER'),
    ('0d19bbf8-b66a-4cc2-9c7c-3fcd961f06b1', 'Cartão de Crédito', 'EXPENSE')
  ) AS v(id, name, type)
WHERE NOT EXISTS (SELECT 1 FROM "categories" c WHERE c."id" = v.id);--> statement-breakpoint
-- 1b. Categorias genéricas usadas só como destino do backfill: não são
--     referenciadas pelo código, então o ID aleatório do seed serve.
INSERT INTO "categories" ("id", "workspace_id", "name", "type", "is_system_category", "parent_id")
SELECT gen_random_uuid()::text, NULL, v.name, v.type, true, NULL
FROM (VALUES
    ('Outros Ganhos', 'INCOME'),
    ('Outros Gastos', 'EXPENSE')
  ) AS v(name, type)
WHERE NOT EXISTS (
  SELECT 1 FROM "categories" c
  WHERE c."workspace_id" IS NULL
    AND c."is_system_category" = true
    AND c."parent_id" IS NULL
    AND c."name" = v.name
    AND c."type" = v.type
);--> statement-breakpoint
-- 2. Em bancos onde `Transferência`/`Cartão de Crédito` já existiam com um UUID
--    aleatório vindo do seed, repõe o ID fixo: aponta os filhos para a linha
--    canônica e remove a duplicata. Sem isso o app ficaria com duas categorias
--    de mesmo nome na lista (o índice único não impede, porque trata NULL de
--    `workspace_id`/`parent_id` como valores distintos).
DO $$
DECLARE
  canonical RECORD;
  legacy_id text;
BEGIN
  FOR canonical IN
    SELECT * FROM (VALUES
        ('19323ba9-e496-4db9-9c22-b2a5c7cb790e', 'Transferência', 'TRANSFER'),
        ('0d19bbf8-b66a-4cc2-9c7c-3fcd961f06b1', 'Cartão de Crédito', 'EXPENSE')
      ) AS v(id, name, type)
  LOOP
    FOR legacy_id IN
      SELECT c.id FROM "categories" c
      WHERE c."workspace_id" IS NULL
        AND c."is_system_category" = true
        AND c."parent_id" IS NULL
        AND c."name" = canonical.name
        AND c."type" = canonical.type
        AND c.id <> canonical.id
    LOOP
      UPDATE "transactions" SET "category_id" = canonical.id WHERE "category_id" = legacy_id;
      UPDATE "recurring_transactions" SET "category_id" = canonical.id WHERE "category_id" = legacy_id;
      UPDATE "categories" SET "parent_id" = canonical.id WHERE "parent_id" = legacy_id;
      DELETE FROM "categories" WHERE id = legacy_id;
    END LOOP;
  END LOOP;
END $$;--> statement-breakpoint
-- 3. Cada transação órfã recebe a categoria genérica do seu próprio tipo.
UPDATE "transactions" t
SET "category_id" = c."id"
FROM "categories" c
WHERE t."category_id" IS NULL
  AND c."workspace_id" IS NULL
  AND c."is_system_category" = true
  AND c."parent_id" IS NULL
  AND c."type" = t."type"
  AND c."name" = CASE t."type"
      WHEN 'INCOME' THEN 'Outros Ganhos'
      WHEN 'EXPENSE' THEN 'Outros Gastos'
      WHEN 'TRANSFER' THEN 'Transferência'
    END;--> statement-breakpoint
UPDATE "recurring_transactions" r
SET "category_id" = c."id"
FROM "categories" c
WHERE r."category_id" IS NULL
  AND c."workspace_id" IS NULL
  AND c."is_system_category" = true
  AND c."parent_id" IS NULL
  AND c."type" = r."type"
  AND c."name" = CASE r."type"
      WHEN 'INCOME' THEN 'Outros Ganhos'
      WHEN 'EXPENSE' THEN 'Outros Gastos'
      WHEN 'TRANSFER' THEN 'Transferência'
    END;--> statement-breakpoint
ALTER TABLE "recurring_transactions" ALTER COLUMN "category_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "transactions" ALTER COLUMN "category_id" SET NOT NULL;
