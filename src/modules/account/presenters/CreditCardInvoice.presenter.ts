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
  dueDate: string;
  periodStart: string;
  periodEnd: string;
  invoiceStatus: 'current' | 'closed' | 'overdue' | 'paid';
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
      dueDate: data.dueDate,
      periodStart: data.periodStart,
      periodEnd: data.periodEnd,
      invoiceStatus: data.invoiceStatus,
    };
  }
}
