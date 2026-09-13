import { AccountPresenter } from '@modules/account/presenters/Account.presenter';
import { Transaction } from '@modules/transaction/entities/Transaction';
import { TransactionPresenter } from '@modules/transaction/presenters/Transaction.presenter';
import { MoneyUtils } from '@utils/MoneyUtils';
import { CreditCard } from '../entities/CreditCardAccount';

interface CreditCardInvoiceData {
  account: CreditCard;
  transactions: Transaction[];
  totalAmount: number;
  pendingAmount: number;
  availableLimit: number | null;
  dueDate: Date;
  periodStart: Date;
  periodEnd: Date;
  invoiceStatus: 'current' | 'closed' | 'overdue';
}

export class CreditCardInvoicePresenter {
  static toHTTP(data: CreditCardInvoiceData) {
    return {
      account: AccountPresenter.toHTTP(data.account),
      transactions: data.transactions.map(TransactionPresenter.toHTTP),
      totalAmount: MoneyUtils.centsToDecimal(data.totalAmount),
      pendingAmount: MoneyUtils.centsToDecimal(data.pendingAmount),
      availableLimit:
        data.availableLimit === null
          ? null
          : MoneyUtils.centsToDecimal(data.availableLimit),
      dueDate: data.dueDate.toISOString(),
      periodStart: data.periodStart.toISOString(),
      periodEnd: data.periodEnd.toISOString(),
      invoiceStatus: data.invoiceStatus,
    };
  }
}
