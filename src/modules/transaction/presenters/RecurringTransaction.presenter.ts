import { MoneyUtils } from '@utils/MoneyUtils';
import { RecurringTransaction } from '../entities/RecurringTransaction';

export class RecurringTransactionPresenter {
  static toHTTP(recurringTransaction: RecurringTransaction) {
    return {
      id: recurringTransaction.id,
      workspaceId: recurringTransaction.workspaceId,
      accountId: recurringTransaction.accountId,
      destinationAccountId: recurringTransaction.destinationAccountId,
      categoryId: recurringTransaction.categoryId,
      title: recurringTransaction.title,
      description: recurringTransaction.description,
      amount: MoneyUtils.centsToDecimal(Number(recurringTransaction.amount)),
      frequency: recurringTransaction.frequency,
      interval: recurringTransaction.interval,
      installmentCount: recurringTransaction.installmentCount,
      startDate: recurringTransaction.startDate,
      endDate: recurringTransaction.endDate,
      type: recurringTransaction.type,
      lastGenerated: recurringTransaction.lastGenerated,
      active: recurringTransaction.active,
    };
  }
}
