import { RecurringTransactionPresenter } from './RecurringTransaction.presenter';
import { TransactionPresenter } from './Transaction.presenter';
import type { InstallmentPurchase } from '../features/create-installment-purchase/create-installment-purchase.service';

export class InstallmentPurchasePresenter {
  static toHTTP({ recurring, firstInstallment }: InstallmentPurchase) {
    return {
      recurring: RecurringTransactionPresenter.toHTTP(recurring),
      firstInstallment: TransactionPresenter.toHTTP(firstInstallment),
    };
  }
}
