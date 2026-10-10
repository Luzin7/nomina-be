import { AccountPresenter } from '@modules/account/presenters/Account.presenter';
import { Transaction } from '@modules/transaction/entities/Transaction';
import { TransactionPresenter } from '@modules/transaction/presenters/Transaction.presenter';
import { MoneyUtils } from '@utils/MoneyUtils';
import { CreditCard } from '../entities/CreditCardAccount';

interface CreditCardInvoiceData {
  account: CreditCard;
  transactions: Transaction[];
  totalAmount: bigint;
  previousBalance: bigint;
  statementTotal: bigint;
  pendingAmount: bigint;
  availableLimit: bigint | null;
  dueDate: string;
  periodStart: string;
  periodEnd: string;
  invoiceStatus: 'current' | 'closed' | 'overdue' | 'paid';
}

const toDecimal = (cents: bigint): number =>
  MoneyUtils.centsToDecimal(Number(cents));

export class CreditCardInvoicePresenter {
  static toHTTP(data: CreditCardInvoiceData) {
    return {
      account: AccountPresenter.toHTTP(data.account),
      transactions: data.transactions.map(TransactionPresenter.toHTTP),
      totalAmount: toDecimal(data.totalAmount),
      previousBalance: toDecimal(data.previousBalance),
      statementTotal: toDecimal(data.statementTotal),
      pendingAmount: toDecimal(data.pendingAmount),
      availableLimit:
        data.availableLimit === null ? null : toDecimal(data.availableLimit),
      dueDate: data.dueDate,
      periodStart: data.periodStart,
      periodEnd: data.periodEnd,
      invoiceStatus: data.invoiceStatus,
    };
  }
}
