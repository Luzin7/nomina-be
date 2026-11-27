import { DrizzleService } from '@infra/databases/drizzle/drizzle.service';
import { CreditCard } from '@modules/account/entities/CreditCardAccount';
import { AnyAccount } from '@modules/account/entities/types';
import {
  BalanceMovementCause,
  GoalProgressSource,
  TransactionStatus,
  TransactionType,
} from '@constants/enums';
import { IdempotencyKeyReusedError } from '@modules/account/errors';
import {
  AccountLastMovement,
  AccountListItem,
  AccountRepository,
  AdjustBalanceInput,
  AdjustBalanceOutcome,
  BalanceAdjustmentRecord,
} from '@modules/account/repositories/contracts/AccountRepository';
import { Injectable } from '@nestjs/common';
import { and, asc, count, desc, eq, sql } from 'drizzle-orm';
import { AccountMapper } from '../mappers/account.mapper';
import * as schema from '../schema';
import { epochMsToDate } from '../sql-helpers';
import { applyBalanceMovement, DrizzleTransaction } from './balance-movement';
import { ensureEntityId } from './ensure-entity-id';
import { insertOpeningMovement } from './opening-movement';
type BalanceAdjustmentRow = typeof schema.balanceAdjustments.$inferSelect;

type LastMovementRow = {
  accountId: string;
  transactionId: string;
  title: string;
  dateEpochMs: string;
  amount: string;
  type: string;
};

function toLastMovement(row: LastMovementRow): AccountLastMovement {
  return {
    accountId: row.accountId,
    transactionId: row.transactionId,
    title: row.title,
    date: epochMsToDate(row.dateEpochMs),
    amountCents: Number(row.amount),
    type: row.type as TransactionType,
  };
}

function toAdjustmentRecord(
  row: BalanceAdjustmentRow,
): BalanceAdjustmentRecord {
  return {
    id: row.id,
    accountId: row.accountId,
    expectedBalanceCents: row.expectedBalanceCents,
    targetBalanceCents: row.targetBalanceCents,
    deltaCents: row.deltaCents,
    movementSeq: row.movementSeq,
    createdAt: row.createdAt,
  };
}

function replayOf(
  existing: BalanceAdjustmentRow,
  input: AdjustBalanceInput,
): AdjustBalanceOutcome {
  const samePayload =
    existing.accountId === input.accountId &&
    existing.expectedBalanceCents === input.expectedBalanceCents &&
    existing.targetBalanceCents === input.targetBalanceCents;

  if (!samePayload) return { status: 'key-reused' };

  return { status: 'replayed', adjustment: toAdjustmentRecord(existing) };
}

@Injectable()
export class AccountRepositoryImplementation implements AccountRepository {
  constructor(private readonly drizzle: DrizzleService) {}

  async create(account: AnyAccount): Promise<AnyAccount> {
    const [createdAccount] = await this.drizzle.db
      .insert(schema.accounts)
      .values(AccountMapper.toDatabase(account))
      .returning();

    return AccountMapper.toDomain(createdAccount);
  }

  async createWithOpeningMovement(
    account: AnyAccount,
    actorId: string,
  ): Promise<void> {
    const accountId = ensureEntityId(account);

    await this.drizzle.db.transaction(async (tx) => {
      await tx
        .insert(schema.accounts)
        .values(AccountMapper.toDatabase(account));

      await insertOpeningMovement(tx, {
        workspaceId: account.workspaceId,
        accountId,
        balance: Number(account.balance),
        actorId,
      });
    });
  }

  async findByNameAndWorkspaceId(
    name: string,
    workspaceId: string,
  ): Promise<AnyAccount | null> {
    const [account] = await this.drizzle.db
      .select()
      .from(schema.accounts)
      .where(
        and(
          eq(schema.accounts.name, name),
          eq(schema.accounts.workspaceId, workspaceId),
        ),
      )
      .limit(1);

    if (!account) return null;

    return AccountMapper.toDomain(account);
  }

  async findById(accountId: string): Promise<AnyAccount | null> {
    const [account] = await this.drizzle.db
      .select()
      .from(schema.accounts)
      .where(eq(schema.accounts.id, accountId))
      .limit(1);

    if (!account) return null;

    return AccountMapper.toDomain(account);
  }

  async update(account: AnyAccount): Promise<AnyAccount> {
    const [updatedAccount] = await this.drizzle.db
      .update(schema.accounts)
      .set(AccountMapper.toUpdatePayload(account))
      .where(eq(schema.accounts.id, account.id))
      .returning();

    return AccountMapper.toDomain(updatedAccount);
  }

  async updateAutoPay(card: CreditCard): Promise<void> {
    await this.drizzle.db
      .update(schema.accounts)
      .set(AccountMapper.toAutoPayUpdatePayload(card))
      .where(
        and(
          eq(schema.accounts.id, card.id),
          eq(schema.accounts.workspaceId, card.workspaceId),
        ),
      );
  }

  async delete(accountId: string): Promise<void> {
    await this.drizzle.db.transaction(async (tx) => {
      await tx.execute(sql`set local lock_timeout = '3s'`);
      await tx.execute(sql`set local statement_timeout = '15s'`);

      await tx
        .select({ id: schema.goals.id })
        .from(schema.goals)
        .where(eq(schema.goals.linkedAccountId, accountId))
        .orderBy(asc(schema.goals.id))
        .for('update');

      const [account] = await tx
        .select({ balance: schema.accounts.balance })
        .from(schema.accounts)
        .where(eq(schema.accounts.id, accountId))
        .for('update');

      if (!account) return;

      await tx
        .update(schema.goals)
        .set({
          progressSource: GoalProgressSource.MANUAL,
          currentCents: Math.max(0, account.balance),
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(schema.goals.linkedAccountId, accountId),
            eq(schema.goals.progressSource, GoalProgressSource.ACCOUNT),
          ),
        );

      await tx.delete(schema.accounts).where(eq(schema.accounts.id, accountId));
    });
  }

  async adjustBalance(
    input: AdjustBalanceInput,
  ): Promise<AdjustBalanceOutcome> {
    try {
      return await this.drizzle.db.transaction((tx) =>
        this.adjustBalanceLocked(tx, input),
      );
    } catch (error) {
      if (error instanceof IdempotencyKeyReusedError) {
        return { status: 'key-reused' };
      }
      throw error;
    }
  }

  async listBalanceAdjustments(
    accountId: string,
    workspaceId: string,
    limit: number,
  ): Promise<BalanceAdjustmentRecord[]> {
    const rows = await this.drizzle.db
      .select()
      .from(schema.balanceAdjustments)
      .where(
        and(
          eq(schema.balanceAdjustments.accountId, accountId),
          eq(schema.balanceAdjustments.workspaceId, workspaceId),
        ),
      )
      .orderBy(
        desc(schema.balanceAdjustments.createdAt),
        desc(schema.balanceAdjustments.movementSeq),
      )
      .limit(limit);

    return rows.map(toAdjustmentRecord);
  }

  private async adjustBalanceLocked(
    tx: DrizzleTransaction,
    input: AdjustBalanceInput,
  ): Promise<AdjustBalanceOutcome> {
    await tx.execute(sql`set local lock_timeout = '3s'`);
    await tx.execute(sql`set local statement_timeout = '15s'`);

    const [account] = await tx
      .select({ balance: schema.accounts.balance })
      .from(schema.accounts)
      .where(
        and(
          eq(schema.accounts.id, input.accountId),
          eq(schema.accounts.workspaceId, input.workspaceId),
        ),
      )
      .for('update');

    if (!account) return { status: 'account-not-found' };

    const [existing] = await tx
      .select()
      .from(schema.balanceAdjustments)
      .where(eq(schema.balanceAdjustments.id, input.id));

    if (existing) return replayOf(existing, input);
    if (account.balance !== input.expectedBalanceCents) {
      return { status: 'balance-changed' };
    }

    const deltaCents = input.targetBalanceCents - account.balance;
    if (deltaCents === 0) return { status: 'unchanged' };

    const movement = await applyBalanceMovement(tx, {
      accountId: input.accountId,
      delta: BigInt(deltaCents),
      cause: BalanceMovementCause.RECONCILIATION,
      transactionId: null,
      actorId: input.actorId,
    });
    if (!movement) return { status: 'account-not-found' };

    const [inserted] = await tx
      .insert(schema.balanceAdjustments)
      .values({
        id: input.id,
        workspaceId: input.workspaceId,
        accountId: input.accountId,
        actorId: input.actorId,
        expectedBalanceCents: input.expectedBalanceCents,
        targetBalanceCents: input.targetBalanceCents,
        deltaCents,
        movementSeq: movement.seq,
      })
      .onConflictDoNothing()
      .returning();

    if (!inserted) throw new IdempotencyKeyReusedError();

    return { status: 'applied', adjustment: toAdjustmentRecord(inserted) };
  }

  async findManyByWorkspaceId(
    workspaceId: string,
    page: number,
    pageSize: number,
  ): Promise<{ accounts: AccountListItem[]; total: number }> {
    const offset = (page - 1) * pageSize;

    const latestMovement = this.drizzle.db
      .select({ createdAt: schema.balanceMovements.createdAt })
      .from(schema.balanceMovements)
      .where(eq(schema.balanceMovements.accountId, schema.accounts.id))
      .orderBy(desc(schema.balanceMovements.seq))
      .limit(1)
      .as('latest_movement');

    const [rows, [{ totalCount }]] = await Promise.all([
      this.drizzle.db
        .select({
          account: schema.accounts,
          balanceUpdatedAt: latestMovement.createdAt,
        })
        .from(schema.accounts)
        .leftJoinLateral(latestMovement, sql`true`)
        .where(eq(schema.accounts.workspaceId, workspaceId))
        .limit(pageSize)
        .offset(offset),

      this.drizzle.db
        .select({ totalCount: count() })
        .from(schema.accounts)
        .where(eq(schema.accounts.workspaceId, workspaceId)),
    ]);

    return {
      accounts: rows.map(({ account, balanceUpdatedAt }) => ({
        account: AccountMapper.toDomain(account),
        balanceUpdatedAt,
      })),
      total: totalCount,
    };
  }

  async findLastMovementsByWorkspaceId(
    workspaceId: string,
  ): Promise<AccountLastMovement[]> {
    return this.drizzle.withStatementTimeout(async (tx) => {
      const rows = await tx.execute<LastMovementRow>(sql`
      SELECT DISTINCT ON (movements.account_id)
        movements.account_id AS "accountId",
        movements.transaction_id AS "transactionId",
        movements.title,
        (EXTRACT(EPOCH FROM movements.date) * 1000)::bigint AS "dateEpochMs",
        movements.amount,
        movements.type
      FROM (
        SELECT
          account_id,
          id AS transaction_id,
          title,
          date,
          amount,
          type,
          created_at
        FROM transactions
        WHERE workspace_id = ${workspaceId}
          AND status = ${TransactionStatus.COMPLETED}
        UNION ALL
        SELECT
          destination_account_id AS account_id,
          id AS transaction_id,
          title,
          date,
          amount,
          type,
          created_at
        FROM transactions
        WHERE workspace_id = ${workspaceId}
          AND status = ${TransactionStatus.COMPLETED}
          AND destination_account_id IS NOT NULL
      ) AS movements
      ORDER BY
        movements.account_id,
        movements.date DESC,
        movements.created_at DESC,
        movements.transaction_id DESC
    `);

      return rows.map(toLastMovement);
    });
  }

  async findAllByWorkspaceId(workspaceId: string): Promise<AnyAccount[]> {
    return this.drizzle.withStatementTimeout(async (tx) => {
      const accounts = await tx
        .select()
        .from(schema.accounts)
        .where(eq(schema.accounts.workspaceId, workspaceId));

      return accounts.map(AccountMapper.toDomain);
    });
  }

  async countByWorkspaceId(workspaceId: string): Promise<number> {
    const [{ totalCount }] = await this.drizzle.db
      .select({ totalCount: count() })
      .from(schema.accounts)
      .where(eq(schema.accounts.workspaceId, workspaceId));

    return totalCount;
  }
}
