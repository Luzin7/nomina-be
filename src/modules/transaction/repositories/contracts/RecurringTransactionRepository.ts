import { RecurrenceFrequency, RecurringKind } from '@constants/enums';
import { RecurringTransaction } from '@modules/transaction/entities/RecurringTransaction';
import { Transaction } from '@modules/transaction/entities/Transaction';

export type FindManyRecurringByWorkspaceQuery = {
  workspaceId: string;
  page: number;
  pageSize: number;
  isActive?: boolean;
  kind?: RecurringKind;
};

export type RecurringRuleSchedule = {
  recurring: RecurringTransaction;
  timezone: string;
};

export type RecurringSummaryRule = {
  id: string;
  title: string;
  type: 'INCOME' | 'EXPENSE';
  amount: number;
  frequency: RecurrenceFrequency;
  interval: number;
  installmentCount: number | null;
  startDate: Date;
  endDate: Date | null;
  active: boolean;
  exhausted: boolean;
  timezone: string;
};

export type FindSummaryRulesQuery = {
  workspaceId: string;
  now: Date;
};

export type DeleteRecurringTransactionQuery = {
  workspaceId: string;
  timezone: string;
  todayStart: Date;
};

export type CreateGeneratedTransactionsResult =
  | { outcome: 'written'; createdCount: number }
  | { outcome: 'skipped-rule-locked' };

export abstract class RecurringTransactionRepository {
  abstract create(
    recurringTransaction: RecurringTransaction,
  ): Promise<RecurringTransaction>;

  abstract update(
    recurringTransaction: RecurringTransaction,
  ): Promise<RecurringTransaction>;

  abstract deleteWithFuturePendingOccurrences(
    id: string,
    query: DeleteRecurringTransactionQuery,
  ): Promise<void>;

  abstract findById(id: string): Promise<RecurringTransaction | null>;

  abstract findManyByWorkspaceId(
    query: FindManyRecurringByWorkspaceQuery,
  ): Promise<{ recurrings: RecurringTransaction[]; total: number }>;

  abstract findNeedingGenerationByWorkspaceId(
    workspaceId: string,
    referenceDate: Date,
  ): Promise<RecurringRuleSchedule[]>;

  abstract listNeedingGeneration(
    referenceDate: Date,
    limit: number,
    afterId: string | null,
  ): Promise<RecurringRuleSchedule[]>;

  abstract createGeneratedTransactions(
    transactions: Transaction[],
    updatedRecurring: RecurringTransaction,
  ): Promise<CreateGeneratedTransactionsResult>;

  abstract findSummaryRules(
    query: FindSummaryRulesQuery,
  ): Promise<RecurringSummaryRule[]>;

  abstract findCompletedRecurringExpense(
    workspaceId: string,
    start: Date,
    end: Date,
  ): Promise<number>;
}
