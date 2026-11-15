import { OpenCardInvoice } from '@modules/account/features/list-open-card-invoices/list-open-card-invoices.handler';
import { MoneyUtils } from '@utils/MoneyUtils';

const toDecimal = (cents: bigint): number =>
  MoneyUtils.centsToDecimal(Number(cents));

export class OpenCardInvoicePresenter {
  static toHTTP(invoice: OpenCardInvoice) {
    return {
      accountId: invoice.account.id,
      accountName: invoice.account.name,
      totalAmount: toDecimal(invoice.totalAmount),
      previousBalance: toDecimal(invoice.previousBalance),
      statementTotal: toDecimal(invoice.statementTotal),
      pendingAmount: toDecimal(invoice.pendingAmount),
      dueDate: invoice.dueDate,
      periodStart: invoice.periodStart,
      periodEnd: invoice.periodEnd,
      invoiceStatus: invoice.invoiceStatus,
    };
  }
}
