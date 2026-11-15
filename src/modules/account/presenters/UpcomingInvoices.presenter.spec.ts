import { UpcomingInvoicesPresenter } from './UpcomingInvoices.presenter';

describe('UpcomingInvoicesPresenter', () => {
  it('exposes the invoice fields in cents', () => {
    const invoice = {
      key: '2026-12',
      periodStart: '2026-11-11',
      periodEnd: '2026-12-10',
      dueDate: '2026-12-15',
      pendingChargesCents: 100,
      projectedCents: 200,
      committedCents: 300,
    };

    expect(UpcomingInvoicesPresenter.toHTTP({ invoices: [invoice] })).toEqual({
      invoices: [invoice],
    });
  });
});
