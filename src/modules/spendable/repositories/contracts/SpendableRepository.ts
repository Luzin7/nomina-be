import type { AccountType, RecurrenceFrequency } from '@constants/enums';

export type SpendableCashFlowInput = {
  workspaceId: string;
  startDate: string;
  endDate: string;
  timezone: string;
};

export type SpendableRecurrence = {
  id: string;
  type: 'INCOME' | 'EXPENSE';
  accountType: AccountType;
  amount: number;
  frequency: RecurrenceFrequency;
  interval: number;
  startDate: Date;
  endDate: Date | null;
  lastGenerated: Date | null;
  materializedDates: Date[];
};

export abstract class SpendableRepository {
  abstract findCycle(workspaceId: string): Promise<string | null>;

  abstract sumPendingCashExpenses(
    input: SpendableCashFlowInput,
  ): Promise<number>;

  abstract sumCompletedCashIncome(
    input: SpendableCashFlowInput,
  ): Promise<number>;

  abstract listActiveRecurrences(
    workspaceId: string,
  ): Promise<SpendableRecurrence[]>;
}
