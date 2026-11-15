SET LOCAL lock_timeout = '5s';--> statement-breakpoint
WITH drifting AS (
  SELECT a.id
  FROM accounts a
  CROSS JOIN LATERAL (
    SELECT COALESCE(SUM(
      CASE
        WHEN t.destination_account_id = a.id THEN -t.amount
        WHEN t.type = 'INCOME' THEN -t.amount
        ELSE t.amount
      END
    ), 0) AS ledger_sum
    FROM transactions t
    WHERE t.workspace_id = a.workspace_id
      AND t.status = 'COMPLETED'
      AND (t.account_id = a.id OR t.destination_account_id = a.id)
  ) l
  WHERE a.type = 'CREDIT_CARD'
    AND l.ledger_sum - a.balance = 124858
    AND NOT EXISTS (
      SELECT 1 FROM balance_movements m
      WHERE m.account_id = a.id AND m.cause = 'RECONCILIATION'
    )
),
fixed AS (
  UPDATE accounts a
  SET balance = a.balance + 124858
  FROM drifting d
  WHERE a.id = d.id
  RETURNING a.id, a.workspace_id, a.balance
)
INSERT INTO balance_movements (workspace_id, account_id, transaction_id, cause, delta, balance_after, actor_id)
SELECT f.workspace_id, f.id, NULL, 'RECONCILIATION', 124858, f.balance, NULL
FROM fixed f;
