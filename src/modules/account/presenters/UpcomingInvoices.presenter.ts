import { UpcomingInvoicesResponse } from '@modules/account/features/get-upcoming-invoices/get-upcoming-invoices.handler';

export class UpcomingInvoicesPresenter {
  static toHTTP({ invoices }: UpcomingInvoicesResponse) {
    return {
      invoices: invoices.map((invoice) => ({
        key: invoice.key,
        periodStart: invoice.periodStart,
        periodEnd: invoice.periodEnd,
        dueDate: invoice.dueDate,
        pendingChargesCents: invoice.pendingChargesCents,
        projectedCents: invoice.projectedCents,
        committedCents: invoice.committedCents,
      })),
    };
  }
}
