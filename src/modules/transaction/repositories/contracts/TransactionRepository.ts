import { TopExpensesByCategory } from '@modules/transaction/valueObjects/TopExpensesByCategory';
import { BalanceMovementCause, TransactionStatus } from '@constants/enums';
import { AnyAccount } from '@modules/account/entities/types';
import { Either } from '@shared/core/errors/Either';
import { RecurringTransaction } from '../../entities/RecurringTransaction';
import { Transaction } from '../../entities/Transaction';

export type BalanceMovementContext = {
  cause?: BalanceMovementCause;
  actorId: string;
};

/**
 * Destino do PATCH /transaction/:id/status. O status desejado é a intenção do
 * cliente; o UPDATE condicional decide se ela ainda está disponível.
 */
export type UpdateTransactionStatusParams = {
  transactionId: string;
  workspaceId: string;
  status: TransactionStatus;
  /**
   * Liquidação de uma parcela já comprada: o limite do cartão e o saldo
   * devedor foram conferidos quando a compra nasceu, então só o job de
   * liquidação liga isto. Alterações pedidas por usuários nunca ligam.
   */
  scheduledSettlement?: boolean;
};

export type DueCardTransactions = {
  transactions: Transaction[];
  totalDue: number;
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
    context: BalanceMovementContext,
  ): Promise<Either<Error, void>>;

  /**
   * Grava a regra de parcelamento e a 1ª parcela (com o efeito no saldo) na
   * mesma transação do banco: ou persistem as duas, ou nenhuma.
   */
  abstract createInstallmentPlan(
    plan: { recurring: RecurringTransaction; firstInstallment: Transaction },
    context: BalanceMovementContext,
  ): Promise<Either<Error, void>>;

  abstract updateWithBalanceEffect(
    transactionId: string,
    mutate: UpdateTransactionMutation,
    context: BalanceMovementContext,
  ): Promise<Either<Error, Transaction>>;

  abstract deleteWithBalanceEffect(
    transactionId: string,
    context: BalanceMovementContext,
  ): Promise<Either<Error, boolean>>;

  abstract updateStatusWithBalanceEffect(
    params: UpdateTransactionStatusParams,
    context: BalanceMovementContext,
  ): Promise<Either<Error, Transaction>>;

  abstract findDueCardTransactions(
    now: Date,
    limit: number,
  ): Promise<DueCardTransactions>;

  abstract findCreditCardLedger(
    accountId: string,
    workspaceId: string,
  ): Promise<Transaction[]>;
}
