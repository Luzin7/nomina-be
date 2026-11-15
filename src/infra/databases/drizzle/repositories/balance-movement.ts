import { BalanceMovementCause } from '@constants/enums';
import { DrizzleService } from '@infra/databases/drizzle/drizzle.service';
import { eq, sql } from 'drizzle-orm';
import * as schema from '../schema';

export type DrizzleTransaction = Parameters<
  Parameters<DrizzleService['db']['transaction']>[0]
>[0];

export type BalanceMovementParams = {
  accountId: string;
  delta: bigint;
  cause: BalanceMovementCause;
  transactionId: string | null;
  actorId: string | null;
};

export type AppliedBalanceMovement = {
  seq: number;
  balanceAfter: number;
  workspaceId: string;
};

export async function applyBalanceMovement(
  tx: DrizzleTransaction,
  { accountId, delta, cause, transactionId, actorId }: BalanceMovementParams,
): Promise<AppliedBalanceMovement | null> {
  const [account] = await tx
    .update(schema.accounts)
    .set({ balance: sql`${schema.accounts.balance} + ${delta}` })
    .where(eq(schema.accounts.id, accountId))
    .returning({
      balance: schema.accounts.balance,
      workspaceId: schema.accounts.workspaceId,
    });

  if (!account) return null;

  const [movement] = await tx
    .insert(schema.balanceMovements)
    .values({
      workspaceId: account.workspaceId,
      accountId,
      transactionId,
      cause,
      delta: Number(delta),
      balanceAfter: account.balance,
      actorId,
    })
    .returning({ seq: schema.balanceMovements.seq });

  return {
    seq: movement.seq,
    balanceAfter: account.balance,
    workspaceId: account.workspaceId,
  };
}
