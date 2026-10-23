import { DrizzleService } from '@infra/databases/drizzle/drizzle.service';
import { AnyAccount } from '@modules/account/entities/types';
import { CreditCard } from '@modules/account/entities/CreditCardAccount';
import { AccountNotFoundError } from '@modules/account/errors';
import {
  AccountType,
  BalanceMovementCause,
  TransactionStatus,
  TransactionType,
} from '@constants/enums';
import { RecurringTransaction } from '@modules/transaction/entities/RecurringTransaction';
import {
  Transaction,
  TransactionBalanceEffect,
} from '@modules/transaction/entities/Transaction';
import {
  TransactionAlreadyCompletedError,
  TransactionAlreadyPendingError,
  TransactionNotFoundError,
  TransactionStatusChangedConcurrentlyError,
} from '@modules/transaction/errors';
import {
  BalanceMovementContext,
  CreateBalanceMutation,
  DueCardTransactions,
  ListTransactionsParams,
  TransactionRepository,
  UpdateTransactionMutation,
  UpdateTransactionStatusParams,
} from '@modules/transaction/repositories/contracts/TransactionRepository';
import { TopExpensesByCategory } from '@modules/transaction/valueObjects/TopExpensesByCategory';
import { Injectable } from '@nestjs/common';
import {
  and,
  AnyColumn,
  count,
  desc,
  eq,
  gte,
  ilike,
  inArray,
  isNotNull,
  lte,
  ne,
  or,
  SQL,
  sql,
  sum,
} from 'drizzle-orm';
import { DomainError } from '@shared/core/errors/DomainError';
import { Either, left, right } from '@shared/core/errors/Either';
import { AccountMapper } from '../mappers/account.mapper';
import { RecurringTransactionMapper } from '../mappers/recurring-transaction.mapper';
import { TransactionMapper } from '../mappers/transaction.mapper';
import * as schema from '../schema';
import { ensureEntityId } from './ensure-entity-id';

const compareIds = (left: string, right: string): number => {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
};

const localDayIn = (instant: SQL, timezone: SQL.Aliased | AnyColumn): SQL =>
  sql`(${instant} AT TIME ZONE ${timezone})::date`;

type DrizzleTransaction = Parameters<
  Parameters<DrizzleService['db']['transaction']>[0]
>[0];

type BalanceMovementEntry = {
  transactionId: string | null;
  cause: BalanceMovementCause;
  actorId: string;
};

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
        ? or(
            eq(schema.transactions.accountId, params.accountId),
            eq(schema.transactions.destinationAccountId, params.accountId),
          )
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
    applyEffects: CreateBalanceMutation,
    context: BalanceMovementContext,
  ): Promise<Either<Error, void>> {
    try {
      await this.drizzle.db.transaction(async (tx) => {
        const accounts = await this.lockAccountsForWrite(tx, transaction);

        await this.persistWithBalanceUpdate(
          tx,
          accounts,
          transaction,
          applyEffects,
          context,
        );
      });

      return right(undefined);
    } catch (error) {
      if (error instanceof DomainError) return left(error);
      throw error;
    }
  }

  async createInstallmentPlan(
    plan: { recurring: RecurringTransaction; firstInstallment: Transaction },
    context: BalanceMovementContext,
  ): Promise<Either<Error, void>> {
    const { recurring, firstInstallment } = plan;

    try {
      await this.drizzle.db.transaction(async (tx) => {
        const accounts = await this.lockAccountsForWrite(tx, firstInstallment);

        await tx
          .insert(schema.recurringTransactions)
          .values(RecurringTransactionMapper.toDatabase(recurring));

        await this.persistWithBalanceUpdate(
          tx,
          accounts,
          firstInstallment,
          (lockedAccounts) =>
            right(
              this.applyBalanceEffects(
                lockedAccounts,
                firstInstallment.balanceEffects(),
              ),
            ),
          context,
        );
      });

      return right(undefined);
    } catch (error) {
      if (error instanceof DomainError) return left(error);
      throw error;
    }
  }

  private async lockAccountsForWrite(
    tx: DrizzleTransaction,
    transaction: Transaction,
  ): Promise<Map<string, AnyAccount>> {
    await tx.execute(sql`set local lock_timeout = '3s'`);
    await tx.execute(sql`set local statement_timeout = '15s'`);

    return this.lockAccounts(tx, [
      transaction.accountId,
      transaction.destinationAccountId,
    ]);
  }

  private async persistWithBalanceUpdate(
    tx: DrizzleTransaction,
    accounts: Map<string, AnyAccount>,
    transaction: Transaction,
    applyEffects: CreateBalanceMutation,
    context: BalanceMovementContext,
  ): Promise<void> {
    const applied = applyEffects(accounts);
    if (applied.isLeft()) throw applied.value;

    const transactionId = ensureEntityId(transaction);

    await tx
      .insert(schema.transactions)
      .values(TransactionMapper.toDatabase(transaction));

    await this.writeBalanceDeltas(tx, applied.value, {
      transactionId,
      cause: context.cause ?? BalanceMovementCause.TRANSACTION_CREATED,
      actorId: context.actorId,
    });
  }

  async updateWithBalanceEffect(
    transactionId: string,
    mutate: UpdateTransactionMutation,
    context: BalanceMovementContext,
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

        await this.writeBalanceDeltas(tx, deltas, {
          transactionId: next.id,
          cause: context.cause ?? BalanceMovementCause.TRANSACTION_UPDATED,
          actorId: context.actorId,
        });
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
    context: BalanceMovementContext,
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

        await this.writeBalanceDeltas(tx, deltas, {
          transactionId: current.id,
          cause: context.cause ?? BalanceMovementCause.TRANSACTION_DELETED,
          actorId: context.actorId,
        });

        return true;
      });

      return right(deleted);
    } catch (error) {
      if (error instanceof DomainError) return left(error);
      throw error;
    }
  }

  async updateStatusWithBalanceEffect(
    params: UpdateTransactionStatusParams,
    context: BalanceMovementContext,
  ): Promise<Either<Error, Transaction>> {
    try {
      const confirmed = await this.drizzle.db.transaction(async (tx) => {
        await tx.execute(sql`set local lock_timeout = '3s'`);
        await tx.execute(sql`set local statement_timeout = '15s'`);

        const [row] = await tx
          .update(schema.transactions)
          .set({ status: params.status })
          .where(
            and(
              eq(schema.transactions.id, params.transactionId),
              eq(schema.transactions.workspaceId, params.workspaceId),
              ne(schema.transactions.status, params.status),
            ),
          )
          .returning();

        if (!row) throw await this.resolveStatusTransitionConflict(tx, params);

        const updated = TransactionMapper.toDomain(row);

        const accounts = await this.lockAccounts(tx, [
          updated.accountId,
          updated.destinationAccountId,
        ]);

        const deltas = this.applyBalanceEffects(
          accounts,
          updated.balanceEffectsFrom(this.statusBefore(updated.status)),
          { scheduledSettlement: params.scheduledSettlement },
        );

        await this.writeBalanceDeltas(tx, deltas, {
          transactionId: updated.id,
          cause: context.cause ?? BalanceMovementCause.STATUS_CHANGED,
          actorId: context.actorId,
        });

        return updated;
      });

      return right(confirmed);
    } catch (error) {
      if (error instanceof DomainError) return left(error);
      throw error;
    }
  }

  /**
   * Zero linhas no UPDATE condicional: ou a transação não existe no workspace,
   * ou já está no status pedido, ou outra requisição mudou o status antes.
   */
  private async resolveStatusTransitionConflict(
    tx: DrizzleTransaction,
    params: UpdateTransactionStatusParams,
  ): Promise<Error> {
    const [current] = await tx
      .select({ status: schema.transactions.status })
      .from(schema.transactions)
      .where(
        and(
          eq(schema.transactions.id, params.transactionId),
          eq(schema.transactions.workspaceId, params.workspaceId),
        ),
      )
      .limit(1);

    if (!current) return new TransactionNotFoundError();
    if (current.status === params.status) {
      return params.status === TransactionStatus.COMPLETED
        ? new TransactionAlreadyCompletedError()
        : new TransactionAlreadyPendingError();
    }

    return new TransactionStatusChangedConcurrentlyError();
  }

  /**
   * O UPDATE só confirma quando o status anterior difere do desejado, então o
   * status anterior é o outro valor do enum.
   */
  private statusBefore(status: TransactionStatus): TransactionStatus {
    switch (status) {
      case TransactionStatus.COMPLETED:
        return TransactionStatus.PENDING;
      case TransactionStatus.PENDING:
        return TransactionStatus.COMPLETED;
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
    ].sort(compareIds);

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
    options: { scheduledSettlement?: boolean } = {},
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

      const applied = options.scheduledSettlement
        ? this.applyScheduledEffect(account, effect)
        : this.applyEffect(account, effect);
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

  private applyEffect(
    account: AnyAccount,
    effect: TransactionBalanceEffect,
  ): Either<Error, void> {
    return effect.kind === 'expense'
      ? account.applyExpenseEffect(effect.amount)
      : account.applyIncomeEffect(effect.amount);
  }

  private applyScheduledEffect(
    account: AnyAccount,
    effect: TransactionBalanceEffect,
  ): Either<Error, void> {
    if (!(account instanceof CreditCard)) {
      return this.applyEffect(account, effect);
    }

    return effect.kind === 'expense'
      ? account.settleScheduledCharge(effect.amount)
      : account.settleScheduledCredit(effect.amount);
  }

  private async writeBalanceDeltas(
    tx: DrizzleTransaction,
    deltas: Map<string, bigint>,
    movement: BalanceMovementEntry,
  ): Promise<void> {
    const ordered = [...deltas.entries()]
      .filter(([, delta]) => delta !== 0n)
      .sort(([leftId], [rightId]) => compareIds(leftId, rightId));

    for (const [accountId, delta] of ordered) {
      const [account] = await tx
        .update(schema.accounts)
        .set({ balance: sql`${schema.accounts.balance} + ${delta}` })
        .where(eq(schema.accounts.id, accountId))
        .returning({
          balance: schema.accounts.balance,
          workspaceId: schema.accounts.workspaceId,
        });

      if (!account) throw new AccountNotFoundError('Conta não encontrada.');

      await tx.insert(schema.balanceMovements).values({
        workspaceId: account.workspaceId,
        accountId,
        transactionId: movement.transactionId,
        cause: movement.cause,
        delta: Number(delta),
        balanceAfter: account.balance,
        actorId: movement.actorId,
      });
    }
  }

  async findDueCardTransactions(
    now: Date,
    limit: number,
  ): Promise<DueCardTransactions> {
    const due = this.dueCardTransactionsFilter(now);

    const rows = await this.drizzle.db
      .select({ transaction: schema.transactions })
      .from(schema.transactions)
      .innerJoin(
        schema.accounts,
        eq(schema.accounts.id, schema.transactions.accountId),
      )
      .where(due)
      .orderBy(schema.transactions.date, schema.transactions.id)
      .limit(limit);

    const [totals] = await this.drizzle.db
      .select({ totalDue: count() })
      .from(schema.transactions)
      .innerJoin(
        schema.accounts,
        eq(schema.accounts.id, schema.transactions.accountId),
      )
      .where(due);

    return {
      transactions: rows.map(({ transaction }) =>
        TransactionMapper.toDomain(transaction),
      ),
      totalDue: totals.totalDue,
    };
  }

  private dueCardTransactionsFilter(now: Date) {
    const transactionDay = localDayIn(
      sql`(${schema.transactions.date}::timestamp AT TIME ZONE 'UTC')`,
      schema.accounts.timezone,
    );
    const today = localDayIn(
      sql`${now.toISOString()}::timestamptz`,
      schema.accounts.timezone,
    );

    return and(
      eq(schema.transactions.status, TransactionStatus.PENDING),
      or(
        isNotNull(schema.transactions.recurringId),
        isNotNull(schema.transactions.installmentGroupId),
      ),
      inArray(schema.transactions.type, [
        TransactionType.EXPENSE,
        TransactionType.INCOME,
      ]),
      eq(schema.accounts.type, AccountType.CREDIT_CARD),
      sql`${transactionDay} <= ${today}`,
    );
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
