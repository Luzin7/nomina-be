import { DrizzleService } from '@infra/databases/drizzle/drizzle.service';
import { sql } from 'drizzle-orm';

type DrizzleTransaction = Parameters<
  Parameters<DrizzleService['db']['transaction']>[0]
>[0];

const recurringRuleLockKey = (id: string) => sql`hashtextextended(${id}, 0)`;

export async function lockRecurringRule(
  tx: DrizzleTransaction,
  id: string,
): Promise<void> {
  await tx.execute(
    sql`SELECT pg_advisory_xact_lock(${recurringRuleLockKey(id)})`,
  );
}

export async function tryLockRecurringRule(
  tx: DrizzleTransaction,
  id: string,
): Promise<boolean> {
  const [row] = await tx.execute<{ locked: boolean }>(
    sql`SELECT pg_try_advisory_xact_lock(${recurringRuleLockKey(id)}) AS locked`,
  );

  return row?.locked === true;
}
