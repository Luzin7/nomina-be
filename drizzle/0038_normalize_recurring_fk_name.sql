DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'transactions_recurring_transaction_id_fkey'
      AND conrelid = 'public.transactions'::regclass
  ) THEN
    ALTER TABLE "transactions" RENAME CONSTRAINT "transactions_recurring_transaction_id_fkey" TO "transactions_recurring_transaction_id_recurring_transactions_id_fk";
  END IF;
END
$$;
