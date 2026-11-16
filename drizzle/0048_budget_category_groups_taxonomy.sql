SET LOCAL lock_timeout = '5s';--> statement-breakpoint
INSERT INTO budget_category_groups (category_name, budget_group)
VALUES
  ('Supermercado', 'essentials'),
  ('Telefonia', 'essentials'),
  ('Pets', 'essentials'),
  ('Presentes', 'lifestyle')
ON CONFLICT DO NOTHING;
