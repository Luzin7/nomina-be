import { DrizzleService } from '@infra/databases/drizzle/drizzle.service';
import { RecurringTransaction } from '@modules/transaction/entities/RecurringTransaction';
import { Transaction } from '@modules/transaction/entities/Transaction';
import { RecurringTransactionRepository } from '@modules/transaction/repositories/contracts/RecurringTransactionRepository';
import { Injectable, Logger } from '@nestjs/common';
import { and, asc, count, eq, gt, isNull, lt, lte, or } from 'drizzle-orm';
import { RecurringTransactionMapper } from '../mappers/recurring-transaction.mapper';
import { TransactionMapper } from '../mappers/transaction.mapper';
import * as schema from '../schema';

@Injectable()
export class RecurringTransactionRepositoryImplementation implements RecurringTransactionRepository {
  private readonly logger = new Logger(
    RecurringTransactionRepositoryImplementation.name,
  );

  constructor(private readonly drizzle: DrizzleService) {}

  async create(
    recurringTransaction: RecurringTransaction,
  ): Promise<RecurringTransaction> {
    const [created] = await this.drizzle.db
      .insert(schema.recurringTransactions)
      .values(RecurringTransactionMapper.toDatabase(recurringTransaction))
      .returning();

    return RecurringTransactionMapper.toDomain(created);
  }

  async update(
    recurringTransaction: RecurringTransaction,
  ): Promise<RecurringTransaction> {
    const [updated] = await this.drizzle.db
      .update(schema.recurringTransactions)
      .set(RecurringTransactionMapper.toDatabase(recurringTransaction))
      .where(eq(schema.recurringTransactions.id, recurringTransaction.id))
      .returning();

    return RecurringTransactionMapper.toDomain(updated);
  }

  async delete(id: string): Promise<void> {
    await this.drizzle.db
      .delete(schema.recurringTransactions)
      .where(eq(schema.recurringTransactions.id, id));
  }

  async findById(id: string): Promise<RecurringTransaction | null> {
    const [recurring] = await this.drizzle.db
      .select()
      .from(schema.recurringTransactions)
      .where(eq(schema.recurringTransactions.id, id))
      .limit(1);

    if (!recurring) return null;
    return RecurringTransactionMapper.toDomain(recurring);
  }

  async findManyByWorkspaceId(
    workspaceId: string,
    page: number,
    pageSize: number,
    isActive?: boolean,
  ): Promise<{ recurrings: RecurringTransaction[]; total: number }> {
    const offset = (page - 1) * pageSize;

    const baseConditions = and(
      eq(schema.recurringTransactions.workspaceId, workspaceId),
      isActive === true
        ? eq(schema.recurringTransactions.active, isActive)
        : undefined,
    );

    const [recurrings, [{ totalCount }]] = await Promise.all([
      this.drizzle.db
        .select()
        .from(schema.recurringTransactions)
        .where(baseConditions)
        .limit(pageSize)
        .offset(offset),

      this.drizzle.db
        .select({ totalCount: count() })
        .from(schema.recurringTransactions)
        .where(baseConditions),
    ]);

    return {
      recurrings: recurrings.map(RecurringTransactionMapper.toDomain),
      total: totalCount,
    };
  }

  async findNeedingGenerationByWorkspaceId(
    workspaceId: string,
    referenceDate: Date,
  ): Promise<RecurringTransaction[]> {
    const recurrings = await this.drizzle.db
      .select()
      .from(schema.recurringTransactions)
      .where(
        and(
          eq(schema.recurringTransactions.workspaceId, workspaceId),
          eq(schema.recurringTransactions.active, true),
          lte(schema.recurringTransactions.startDate, referenceDate),
          or(
            isNull(schema.recurringTransactions.lastGenerated),
            lt(schema.recurringTransactions.lastGenerated, referenceDate),
          ),
        ),
      );

    return recurrings.map(RecurringTransactionMapper.toDomain);
  }

  async listNeedingGeneration(
    referenceDate: Date,
    limit: number,
    afterId: string | null,
  ): Promise<RecurringTransaction[]> {
    const recurrings = await this.drizzle.db
      .select()
      .from(schema.recurringTransactions)
      .where(
        and(
          eq(schema.recurringTransactions.active, true),
          lte(schema.recurringTransactions.startDate, referenceDate),
          or(
            isNull(schema.recurringTransactions.lastGenerated),
            lt(schema.recurringTransactions.lastGenerated, referenceDate),
          ),
          afterId !== null
            ? gt(schema.recurringTransactions.id, afterId)
            : undefined,
        ),
      )
      .orderBy(asc(schema.recurringTransactions.id))
      .limit(limit);

    return recurrings.map(RecurringTransactionMapper.toDomain);
  }

  async createGeneratedTransactions(
    transactions: Transaction[],
    updatedRecurring: RecurringTransaction,
  ): Promise<number> {
    return this.drizzle.db.transaction(async (tx) => {
      let insertedCount = 0;

      if (transactions.length > 0) {
        const inserted = await tx
          .insert(schema.transactions)
          .values(transactions.map(TransactionMapper.toDatabase))
          .onConflictDoNothing({
            target: [schema.transactions.recurringId, schema.transactions.date],
          })
          .returning({ id: schema.transactions.id });

        insertedCount = inserted.length;

        const skippedCount = transactions.length - insertedCount;

        if (skippedCount > 0) {
          this.logger.warn(
            `Job: ${skippedCount} transação(ões) já existiam para a recorrência ${updatedRecurring.id}; geração ignorada.`,
          );
        }
      }

      await tx
        .update(schema.recurringTransactions)
        .set({
          lastGenerated: updatedRecurring.lastGenerated,
          active: updatedRecurring.active,
        })
        .where(eq(schema.recurringTransactions.id, updatedRecurring.id));

      return insertedCount;
    });
  }
}
