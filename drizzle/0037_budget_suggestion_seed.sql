SET LOCAL lock_timeout = '5s';--> statement-breakpoint
INSERT INTO budget_parameters (key, effective_from, value_cents)
VALUES ('minimum_wage', '2026-01-01', 162100)
ON CONFLICT DO NOTHING;--> statement-breakpoint
INSERT INTO budget_income_brackets (version, position, max_minimum_wages, essentials_bp, lifestyle_bp, savings_bp)
VALUES
  (1, 1, 2.00, 7000, 2000, 1000),
  (1, 2, 5.00, 6000, 2500, 1500),
  (1, 3, 10.00, 5000, 3000, 2000),
  (1, 4, NULL, 4500, 2500, 3000)
ON CONFLICT DO NOTHING;--> statement-breakpoint
INSERT INTO budget_category_groups (category_name, budget_group)
VALUES
  ('Moradia', 'essentials'),
  ('Aluguel', 'essentials'),
  ('Condomínio', 'essentials'),
  ('Água', 'essentials'),
  ('Luz', 'essentials'),
  ('Internet', 'essentials'),
  ('Alimentação', 'essentials'),
  ('Mercado', 'essentials'),
  ('Transporte', 'essentials'),
  ('Combustível', 'essentials'),
  ('Transporte Público', 'essentials'),
  ('Estacionamento', 'essentials'),
  ('Saúde', 'essentials'),
  ('Farmácia', 'essentials'),
  ('Plano de Saúde', 'essentials'),
  ('Seguro', 'essentials'),
  ('Serviços', 'essentials'),
  ('Educação', 'essentials'),
  ('Material', 'essentials'),
  ('Impostos', 'essentials'),
  ('Lazer', 'lifestyle'),
  ('Restaurante', 'lifestyle'),
  ('Delivery', 'lifestyle'),
  ('Viagem', 'lifestyle'),
  ('Compras', 'lifestyle'),
  ('Vestuário', 'lifestyle'),
  ('Outros Gastos', 'lifestyle'),
  ('Investimentos', 'savings')
ON CONFLICT DO NOTHING;
