-- Objetivo: contar e amostrar (somente ids) as recorrências de cartão de crédito que viram parcelamento no backfill de recurring_transactions.installment_count (migration 0023); "unmatched" ficam NULL (data final fora da grade); "suspect_*" são casos para conferir à mão. A grade é comparada por data de calendário local da conta. Somente leitura; rodar em produção apenas com ok do dono, no release. Rodar DEPOIS da migration 0023 (usa a coluna installment_count).
BEGIN READ ONLY;
SET LOCAL TIME ZONE 'UTC';

WITH candidates AS (
  SELECT rt.id,
         rt.frequency,
         rt.interval,
         (rt.start_date::timestamptz AT TIME ZONE a.time_zone) AS local_start,
         (rt.end_date::timestamptz AT TIME ZONE a.time_zone) AS local_end
  FROM recurring_transactions rt
  JOIN accounts a ON a.id = rt.account_id
  WHERE rt.type = 'EXPENSE'
    AND rt.end_date IS NOT NULL
    AND a.type = 'CREDIT_CARD'
    AND rt.installment_count IS NULL
),
inferred AS (
  SELECT c.id, (MIN(s.k) + 1)::int AS installment_count
  FROM candidates c
  CROSS JOIN LATERAL generate_series(0, 364) AS s(k)
  WHERE (c.local_start + CASE c.frequency
      WHEN 'WEEKLY' THEN make_interval(days => c.interval * 7 * s.k)
      WHEN 'MONTHLY' THEN make_interval(months => c.interval * s.k)
      WHEN 'YEARLY' THEN make_interval(years => c.interval * s.k)
    END)::date = c.local_end::date
  GROUP BY c.id
),
report AS (
  SELECT 'candidates' AS section, NULL::text AS id, (SELECT COUNT(*) FROM candidates)::int AS value
  UNION ALL
  SELECT 'inferred', NULL, (SELECT COUNT(*) FROM inferred)::int
  UNION ALL
  SELECT 'unmatched', NULL, (SELECT COUNT(*) FROM candidates c WHERE NOT EXISTS (SELECT 1 FROM inferred i WHERE i.id = c.id))::int
  UNION ALL
  SELECT 'candidates_in_dst_zones', NULL, (SELECT COUNT(*) FROM candidates c JOIN recurring_transactions r USING (id) JOIN accounts a ON a.id = r.account_id
    WHERE ('2026-01-15 12:00'::timestamp AT TIME ZONE a.time_zone) - ('2026-01-15 12:00'::timestamp AT TIME ZONE 'UTC')
       <> ('2026-07-15 12:00'::timestamp AT TIME ZONE a.time_zone) - ('2026-07-15 12:00'::timestamp AT TIME ZONE 'UTC'))::int
  UNION ALL
  (SELECT 'sample_inferred', id, installment_count FROM inferred ORDER BY id LIMIT 10)
  UNION ALL
  (SELECT 'sample_unmatched', c.id, NULL FROM candidates c
   WHERE NOT EXISTS (SELECT 1 FROM inferred i WHERE i.id = c.id)
   ORDER BY c.id LIMIT 10)
  UNION ALL
  (SELECT 'suspect_' || CASE WHEN i.installment_count = 1 THEN 'single'
                             WHEN c.frequency <> 'MONTHLY' OR c.interval <> 1 THEN 'non_monthly'
                             ELSE 'over_24' END,
          i.id, i.installment_count
   FROM inferred i JOIN candidates c USING (id)
   WHERE i.installment_count = 1 OR c.frequency <> 'MONTHLY' OR c.interval <> 1 OR i.installment_count > 24
   ORDER BY i.id LIMIT 20)
)
SELECT section, id, value FROM report;

ROLLBACK;
