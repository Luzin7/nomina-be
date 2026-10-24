import { Transaction } from '../entities/Transaction';

export class TransactionPreviewPresenter {
  static toHTTP(transaction: Transaction) {
    return {
      id: transaction.id,
      type: transaction.type,
      title: transaction.title,
      description: transaction.description,
      accountId: transaction.accountId,
      destinationAccountId: transaction.destinationAccountId,
      categoryId: transaction.categoryId,
      amount: transaction.amountDecimal,
      date: transaction.date,
      status: transaction.status,
      recurringId: transaction.recurringId,
      installmentNumber: transaction.installmentNumber,
      installmentCount: transaction.installmentCount,
    };
  }
}
