import { DrizzleService } from '@infra/databases/drizzle/drizzle.service';
import { AnyAccount } from '@modules/account/entities/types';
import {
  AccountListItem,
  AccountRepository,
} from '@modules/account/repositories/contracts/AccountRepository';
import { Injectable } from '@nestjs/common';
import { and, count, desc, eq, sql } from 'drizzle-orm';
import { AccountMapper } from '../mappers/account.mapper';
import * as schema from '../schema';
import { ensureEntityId } from './ensure-entity-id';
import { insertOpeningMovement } from './opening-movement';

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

  async delete(accountId: string): Promise<void> {
    await this.drizzle.db
      .delete(schema.accounts)
      .where(eq(schema.accounts.id, accountId));
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

  async findAllByWorkspaceId(workspaceId: string): Promise<AnyAccount[]> {
    const accounts = await this.drizzle.db
      .select()
      .from(schema.accounts)
      .where(eq(schema.accounts.workspaceId, workspaceId));

    return accounts.map(AccountMapper.toDomain);
  }

  async countByWorkspaceId(workspaceId: string): Promise<number> {
    const [{ totalCount }] = await this.drizzle.db
      .select({ totalCount: count() })
      .from(schema.accounts)
      .where(eq(schema.accounts.workspaceId, workspaceId));

    return totalCount;
  }
}
