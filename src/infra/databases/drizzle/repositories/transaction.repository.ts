import { DrizzleService } from '@infra/databases/drizzle/drizzle.service';
import { AnyAccount } from '@modules/account/entities/types';
import { AccountNotFoundError } from '@modules/account/errors';
import { TransactionStatus } from '@constants/enums';
import {
  Transaction,
  TransactionBalanceEffect,
} from '@modules/transaction/entities/Transaction';
import { TransactionNotFoundError } from '@modules/transaction/errors';
import {
  ListTransactionsParams,
  TransactionRepository,
  UpdateTransactionMutation,
} from '@modules/transaction/repositories/contracts/TransactionRepository';
import { TopExpensesByCategory } from '@modules/transaction/valueObjects/TopExpensesByCategory';
import { Injectable } from '@nestjs/common';
import {
  and,
  count,
  desc,
  eq,
  gte,
  ilike,
  inArray,
  lte,
  or,
  sql,
  sum,
} from 'drizzle-orm';
import { DomainError } from '@shared/core/errors/DomainError';
import { Either, left, right } from '@shared/core/errors/Either';
import { AccountMapper } from '../mappers/account.mapper';
import { TransactionMapper } from '../mappers/transaction.mapper';
import * as schema from '../schema';

type DrizzleTransaction = Parameters<
  Parameters<DrizzleService['db']['transaction']>[0]
>[0];

@Injectable()
export class TransactionRepositoryImplementation implements TransactionRepository {
  constructor(private readonly drizzle: DrizzleService) {}

  async create(transaction: Transaction): Promise<void> {
    await this.drizzle.db
      .insert(schema.transactions)
      .values(TransactionMapper.toDatabase(transaction));
  }

  async findUniqueById(id: string): Promise<Transaction | null> {
    const [transaction] = await this.drizzle.db
      .select()
      .from(schema.transactions)
      .where(eq(schema.transactions.id, id))
      .limit(1);

    return transaction ? TransactionMapper.toDomain(transaction) : null;
  }

  async listTransactionsByWorkspaceId(
    params: ListTransactionsParams,
  ): Promise<{ transactions: Transaction[]; total: number }> {
    const whereConditions = and(
      eq(schema.transactions.workspaceId, params.workspaceId),
      params.startDate
        ? gte(schema.transactions.date, params.startDate)
        : undefined,
      params.endDate
        ? lte(schema.transactions.date, params.endDate)
        : undefined,
      params.type ? eq(schema.transactions.type, params.type) : undefined,
      params.categoryId
        ? eq(schema.transactions.categoryId, params.categoryId)
        : undefined,
      params.accountId
        ? eq(schema.transactions.accountId, params.accountId)
        : undefined,
      params.title
        ? ilike(schema.transactions.title, `%${params.title}%`)
        : undefined,
      params.status ? eq(schema.transactions.status, params.status) : undefined,
    );

    const [transactionsRaw, [{ totalCount }]] = await Promise.all([
      this.drizzle.db
        .select()
        .from(schema.transactions)
        .where(whereConditions)
        .limit(params.pageSize)
        .offset((params.page - 1) * params.pageSize)
        .orderBy(
          desc(schema.transactions.date),
          desc(schema.transactions.createdAt),
        ),

      this.drizzle.db
        .select({ totalCount: count() })
        .from(schema.transactions)
        .where(whereConditions),
    ]);

    return {
      transactions: transactionsRaw.map(TransactionMapper.toDomain),
      total: totalCount,
    };
  }

  async getTopExpensesByCategory(params: {
    workspaceId: string;
    startDate: Date;
    endDate: Date;
    pageSize: number;
  }): Promise<{ expenses: TopExpensesByCategory[]; totalExpense: number }> {
    const { workspaceId, startDate, endDate, pageSize } = params;

    const periodFilter = and(
      eq(schema.transactions.workspaceId, workspaceId),
      eq(schema.transactions.type, 'EXPENSE'),
      eq(schema.transactions.status, 'COMPLETED'),
      gte(schema.transactions.date, startDate),
      lte(schema.transactions.date, endDate),
    );

    const [results, [{ totalExpense }]] = await Promise.all([
      this.drizzle.db
        .select({
          categoryId: schema.transactions.categoryId,
          categoryName: schema.categories.name,
          totalAmount: sum(schema.transactions.amount).mapWith(Number),
        })
        .from(schema.transactions)
        .innerJoin(
          schema.categories,
          eq(schema.categories.id, schema.transactions.categoryId),
        )
        .where(periodFilter)
        .groupBy(schema.transactions.categoryId, schema.categories.name)
        .orderBy(desc(sum(schema.transactions.amount)))
        .limit(pageSize),

      this.drizzle.db
        .select({
          totalExpense:
            sql<number>`COALESCE(SUM(${schema.transactions.amount}), 0)`.mapWith(
              Number,
            ),
        })
        .from(schema.transactions)
        .where(periodFilter),
    ]);

    return {
      expenses: results.map(
        (r) =>
          new TopExpensesByCategory({
            categoryId: r.categoryId,
            categoryName: r.categoryName,
            amount: r.totalAmount,
          }),
      ),
      totalExpense,
    };
  }

  async sumTransactionsByDateRange(
    workspaceId: string,
    startDate: Date,
    endDate: Date,
  ): Promise<{ totalIncome: number; totalExpense: number; balance: number }> {
    const results = await this.drizzle.db
      .select({
        type: schema.transactions.type,
        total: sum(schema.transactions.amount).mapWith(Number),
      })
      .from(schema.transactions)
      .where(
        and(
          eq(schema.transactions.workspaceId, workspaceId),
          eq(schema.transactions.status, 'COMPLETED'),
          gte(schema.transactions.date, startDate),
          lte(schema.transactions.date, endDate),
        ),
      )
      .groupBy(schema.transactions.type);

    let totalIncome = 0;
    let totalExpense = 0;

    for (const row of results) {
      if (row.type === 'INCOME') totalIncome += row.total;
      if (row.type === 'EXPENSE') totalExpense += row.total;
    }

    return {
      totalIncome,
      totalExpense,
      balance: totalIncome - totalExpense,
    };
  }

  async createWithBalanceUpdate(
    transaction: Transaction,
    sourceDelta: bigint,
    destinationDelta?: bigint,
  ): Promise<void> {
    await this.drizzle.db.transaction(async (tx) => {
      await tx
        .insert(schema.transactions)
        .values(TransactionMapper.toDatabase(transaction));

      const deltas = new Map<string, bigint>([
        [transaction.accountId, sourceDelta],
      ]);

      if (transaction.destinationAccountId && destinationDelta !== undefined) {
        const currentDelta = deltas.get(transaction.destinationAccountId) ?? 0n;
        deltas.set(
          transaction.destinationAccountId,
          currentDelta + destinationDelta,
        );
      }

      await this.writeBalanceDeltas(tx, deltas);
    });
  }

  async updateWithBalanceEffect(
    transactionId: string,
    mutate: UpdateTransactionMutation,
  ): Promise<Either<Error, Transaction>> {
    try {
      const updated = await this.drizzle.db.transaction(async (tx) => {
        await tx.execute(sql`set local lock_timeout = '3s'`);
        await tx.execute(sql`set local statement_timeout = '15s'`);

        const current = await this.lockTransaction(tx, transactionId);
        if (!current) throw new TransactionNotFoundError();

        const mutated = mutate(current);
        if (mutated.isLeft()) throw mutated.value;
        const next = mutated.value;

        const accounts = await this.lockAccounts(tx, [
          current.accountId,
          current.destinationAccountId,
          next.accountId,
          next.destinationAccountId,
        ]);

        const deltas = this.applyBalanceEffects(accounts, [
          ...current.revertedBalanceEffects(),
          ...next.balanceEffects(),
        ]);

        await this.writeBalanceDeltas(tx, deltas);
        await tx
          .update(schema.transactions)
          .set(TransactionMapper.toDatabase(next))
          .where(eq(schema.transactions.id, next.id));

        return next;
      });

      return right(updated);
    } catch (error) {
      if (error instanceof DomainError) return left(error);
      throw error;
    }
  }

  async deleteWithBalanceEffect(
    transactionId: string,
  ): Promise<Either<Error, boolean>> {
    try {
      const deleted = await this.drizzle.db.transaction(async (tx) => {
        await tx.execute(sql`set local lock_timeout = '3s'`);
        await tx.execute(sql`set local statement_timeout = '15s'`);

        const current = await this.lockTransaction(tx, transactionId);
        if (!current) throw new TransactionNotFoundError();

        const accounts = await this.lockAccounts(tx, [
          current.accountId,
          current.destinationAccountId,
        ]);

        const deltas = this.applyBalanceEffects(
          accounts,
          current.revertedBalanceEffects(),
        );

        const rows = await tx
          .delete(schema.transactions)
          .where(eq(schema.transactions.id, current.id))
          .returning({ id: schema.transactions.id });
        if (rows.length === 0) return false;

        await this.writeBalanceDeltas(tx, deltas);

        return true;
      });

      return right(deleted);
    } catch (error) {
      if (error instanceof DomainError) return left(error);
      throw error;
    }
  }

  async toggleStatusWithBalanceEffect(
    transactionId: string,
  ): Promise<Either<Error, Transaction>> {
    try {
      const toggled = await this.drizzle.db.transaction(async (tx) => {
        await tx.execute(sql`set local lock_timeout = '3s'`);
        await tx.execute(sql`set local statement_timeout = '15s'`);

        const current = await this.lockTransaction(tx, transactionId);
        if (!current) throw new TransactionNotFoundError();

        const accounts = await this.lockAccounts(tx, [
          current.accountId,
          current.destinationAccountId,
        ]);

        const wasCompleted = current.status === TransactionStatus.COMPLETED;
        const revertedEffects = current.revertedBalanceEffects();
        const toggleResult = wasCompleted
          ? current.markAsPending()
          : current.complete();
        if (toggleResult.isLeft()) throw toggleResult.value;

        const deltas = this.applyBalanceEffects(accounts, [
          ...revertedEffects,
          ...current.balanceEffects(),
        ]);

        await this.writeBalanceDeltas(tx, deltas);
        await tx
          .update(schema.transactions)
          .set(TransactionMapper.toDatabase(current))
          .where(eq(schema.transactions.id, current.id));

        return current;
      });

      return right(toggled);
    } catch (error) {
      if (error instanceof DomainError) return left(error);
      throw error;
    }
  }

  private async lockTransaction(
    tx: DrizzleTransaction,
    transactionId: string,
  ): Promise<Transaction | null> {
    const [row] = await tx
      .select()
      .from(schema.transactions)
      .where(eq(schema.transactions.id, transactionId))
      .limit(1)
      .for('update');

    return row ? TransactionMapper.toDomain(row) : null;
  }

  private async lockAccounts(
    tx: DrizzleTransaction,
    accountIds: (string | null)[],
  ): Promise<Map<string, AnyAccount>> {
    const ids = [
      ...new Set(accountIds.filter((id): id is string => !!id)),
    ].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

    if (ids.length === 0) return new Map();

    const rows = await tx
      .select()
      .from(schema.accounts)
      .where(inArray(schema.accounts.id, ids))
      .orderBy(schema.accounts.id)
      .for('update');

    return new Map(rows.map((row) => [row.id, AccountMapper.toDomain(row)]));
  }

  /**
   * Aplica os efeitos nas contas travadas e devolve a variação de saldo de cada
   * uma. Quem diz de quanto o saldo muda é a conta; aqui só comparamos com o
   * valor travado antes dos efeitos.
   */
  private applyBalanceEffects(
    accounts: Map<string, AnyAccount>,
    effects: TransactionBalanceEffect[],
  ): Map<string, bigint> {
    const initialBalances = new Map<string, bigint>();

    for (const effect of effects) {
      const account = accounts.get(effect.accountId);
      if (!account) {
        throw new AccountNotFoundError('Conta não encontrada.');
      }

      if (!initialBalances.has(account.id)) {
        initialBalances.set(account.id, account.balance);
      }

      const applied =
        effect.kind === 'expense'
          ? account.applyExpenseEffect(effect.amount)
          : account.applyIncomeEffect(effect.amount);
      if (applied.isLeft()) throw applied.value;
    }

    const deltas = new Map<string, bigint>();
    for (const [accountId, initialBalance] of initialBalances) {
      const account = accounts.get(accountId);
      if (!account) continue;
      deltas.set(accountId, account.balance - initialBalance);
    }

    return deltas;
  }

  private async writeBalanceDeltas(
    tx: DrizzleTransaction,
    deltas: Map<string, bigint>,
  ): Promise<void> {
    const ordered = [...deltas.entries()]
      .filter(([, delta]) => delta !== 0n)
      .sort(([leftId], [rightId]) =>
        leftId < rightId ? -1 : leftId > rightId ? 1 : 0,
      );

    for (const [accountId, delta] of ordered) {
      await tx
        .update(schema.accounts)
        .set({ balance: sql`${schema.accounts.balance} + ${delta}` })
        .where(eq(schema.accounts.id, accountId));
    }
  }

  async findCreditCardLedger(
    accountId: string,
    workspaceId: string,
  ): Promise<Transaction[]> {
    const rows = await this.drizzle.db
      .select()
      .from(schema.transactions)
      .where(
        and(
          eq(schema.transactions.workspaceId, workspaceId),
          or(
            eq(schema.transactions.accountId, accountId),
            eq(schema.transactions.destinationAccountId, accountId),
          ),
        ),
      )
      .orderBy(desc(schema.transactions.date));

    return rows.map(TransactionMapper.toDomain);
  }
}
