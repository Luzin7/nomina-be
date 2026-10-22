import { TopExpensesByCategory } from '@modules/transaction/valueObjects/TopExpensesByCategory';
import { Either } from '@shared/core/errors/Either';
import { Transaction } from '../../entities/Transaction';

export interface ListTransactionsParams {
  workspaceId: string;
  page: number;
  pageSize: number;
  startDate?: Date;
  endDate?: Date;
  type?: string;
  categoryId?: string;
  accountId?: string;
  title?: string;
  status?: string;
}

/**
 * Recebe a transação travada e devolve a versão resultante da edição. Roda
 * dentro da transação do banco, então os efeitos financeiros são derivados do
 * estado atual da linha, não do que o serviço leu antes.
 */
export type UpdateTransactionMutation = (
  current: Transaction,
) => Either<Error, Transaction>;

export abstract class TransactionRepository {
  abstract create(transaction: Transaction): Promise<void>;
  abstract findUniqueById(id: string): Promise<Transaction | null>;
  abstract listTransactionsByWorkspaceId(
    params: ListTransactionsParams,
  ): Promise<{ transactions: Transaction[]; total: number }>;

  abstract getTopExpensesByCategory(params: {
    workspaceId: string;
    startDate: Date;
    endDate: Date;
    pageSize: number;
  }): Promise<{ expenses: TopExpensesByCategory[]; totalExpense: number }>;

  abstract sumTransactionsByDateRange(
    workspaceId: string,
    startDate: Date,
    endDate: Date,
  ): Promise<{
    totalIncome: number;
    totalExpense: number;
    balance: number;
  }>;

  abstract createWithBalanceUpdate(
    transaction: Transaction,
    sourceDelta: bigint,
    destinationDelta?: bigint,
  ): Promise<void>;

  abstract updateWithBalanceEffect(
    transactionId: string,
    mutate: UpdateTransactionMutation,
  ): Promise<Either<Error, Transaction>>;

  abstract deleteWithBalanceEffect(
    transactionId: string,
  ): Promise<Either<Error, boolean>>;

  abstract toggleStatusWithBalanceEffect(
    transactionId: string,
  ): Promise<Either<Error, Transaction>>;

  abstract findCreditCardLedger(
    accountId: string,
    workspaceId: string,
  ): Promise<Transaction[]>;
}
