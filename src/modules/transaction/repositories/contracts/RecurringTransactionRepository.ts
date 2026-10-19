import { RecurringTransaction } from '@modules/transaction/entities/RecurringTransaction';
import { Transaction } from '@modules/transaction/entities/Transaction';

export abstract class RecurringTransactionRepository {
  abstract create(
    recurringTransaction: RecurringTransaction,
  ): Promise<RecurringTransaction>;

  abstract update(
    recurringTransaction: RecurringTransaction,
  ): Promise<RecurringTransaction>;

  abstract delete(id: string): Promise<void>;

  abstract findById(id: string): Promise<RecurringTransaction | null>;

  abstract findManyByWorkspaceId(
    workspaceId: string,
    page: number,
    pageSize: number,
    isActive?: boolean,
  ): Promise<{ recurrings: RecurringTransaction[]; total: number }>;

  abstract findNeedingGenerationByWorkspaceId(
    workspaceId: string,
    referenceDate: Date,
  ): Promise<RecurringTransaction[]>;

  abstract listNeedingGeneration(
    referenceDate: Date,
    limit: number,
    afterId: string | null,
  ): Promise<RecurringTransaction[]>;

  abstract createGeneratedTransactions(
    transactions: Transaction[],
    updatedRecurring: RecurringTransaction,
  ): Promise<number>;
}
