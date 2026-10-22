import { TopExpensesByCategory } from '@modules/transaction/valueObjects/TopExpensesByCategory';
import { BalanceMovementCause } from '@constants/enums';
import { AnyAccount } from '@modules/account/entities/types';
import { Either } from '@shared/core/errors/Either';
import { Transaction } from '../../entities/Transaction';

export type BalanceMovementContext = {
  cause?: BalanceMovementCause;
  actorId?: string;
};

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

/**
 * Recebe as contas travadas e devolve a variação de saldo que a criação
 * provoca em cada uma. Roda dentro da transação do banco, então a regra de
 * limite e de fundos enxerga o saldo travado, não o que o serviço leu antes.
 */
export type CreateBalanceMutation = (
  lockedAccounts: Map<string, AnyAccount>,
) => Either<Error, Map<string, bigint>>;

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
    applyEffects: CreateBalanceMutation,
    context?: BalanceMovementContext,
  ): Promise<Either<Error, void>>;

  abstract updateWithBalanceEffect(
    transactionId: string,
    mutate: UpdateTransactionMutation,
    context?: BalanceMovementContext,
  ): Promise<Either<Error, Transaction>>;

  abstract deleteWithBalanceEffect(
    transactionId: string,
    context?: BalanceMovementContext,
  ): Promise<Either<Error, boolean>>;

  abstract toggleStatusWithBalanceEffect(
    transactionId: string,
    context?: BalanceMovementContext,
  ): Promise<Either<Error, Transaction>>;

  abstract findCreditCardLedger(
    accountId: string,
    workspaceId: string,
  ): Promise<Transaction[]>;
}
