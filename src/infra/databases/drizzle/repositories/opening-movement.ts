import { BalanceMovementCause } from '@constants/enums';
import { DrizzleService } from '@infra/databases/drizzle/drizzle.service';
import * as schema from '../schema';

type DrizzleTransaction = Parameters<
  Parameters<DrizzleService['db']['transaction']>[0]
>[0];

export type OpeningMovementParams = {
  workspaceId: string;
  accountId: string;
  balance: number;
  actorId: string;
};

export async function insertOpeningMovement(
  tx: DrizzleTransaction,
  { workspaceId, accountId, balance, actorId }: OpeningMovementParams,
): Promise<void> {
  await tx.insert(schema.balanceMovements).values({
    workspaceId,
    accountId,
    transactionId: null,
    cause: BalanceMovementCause.OPENING,
    delta: balance,
    balanceAfter: balance,
    actorId,
  });
}
