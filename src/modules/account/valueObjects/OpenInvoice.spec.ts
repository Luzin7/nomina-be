import { InvoiceCalendar } from './InvoiceCalendar';
import {
  openInvoiceOf,
  payableInvoiceOf,
  type InvoiceDueWindow,
} from './OpenInvoice';

const windowOf = (from: string, to: string): InvoiceDueWindow => ({
  contains: (date) => date >= from && date <= to,
});

const calendar = new InvoiceCalendar({
  dueDay: 28,
  closingDaysBeforeDue: 7,
});

const current = (today: string) =>
  calendar.bounds(calendar.invoiceKeyFor(today));

describe('openInvoiceOf', () => {
  it('keeps the current invoice while its due date is inside the window', () => {
    const invoice = openInvoiceOf(
      calendar,
      current('2026-11-20'),
      windowOf('2026-11-01', '2026-11-30'),
    );

    expect(invoice.key).toBe('2026-11');
    expect(invoice.dueDate).toBe('2026-11-28');
  });

  it('falls back to the previous invoice once the current due date leaves the window', () => {
    const invoice = openInvoiceOf(
      calendar,
      current('2026-11-20'),
      windowOf('2026-11-01', '2026-11-27'),
    );

    expect(invoice.key).toBe('2026-10');
    expect(invoice.dueDate).toBe('2026-10-28');
  });

  it('keeps the current invoice when its due date is the last day of the window', () => {
    const invoice = openInvoiceOf(
      calendar,
      current('2026-11-20'),
      windowOf('2026-11-01', '2026-11-28'),
    );

    expect(invoice.key).toBe('2026-11');
    expect(invoice.dueDate).toBe('2026-11-28');
  });

  it('falls from the January current invoice back to the December key', () => {
    const invoice = openInvoiceOf(
      calendar,
      current('2026-12-25'),
      windowOf('2026-12-01', '2026-12-31'),
    );

    expect(invoice.key).toBe('2026-12');
    expect(invoice.dueDate).toBe('2026-12-28');
  });

  it('falls from the current invoice even when the previous one is overdue', () => {
    const invoice = openInvoiceOf(
      calendar,
      current('2026-11-06'),
      windowOf('2026-11-02', '2026-11-08'),
    );

    expect(invoice.key).toBe('2026-10');
    expect(invoice.dueDate).toBe('2026-10-28');
  });
});

describe('payableInvoiceOf', () => {
  it('keeps the previous invoice while it still has an amount to pay', () => {
    const currentInvoice = current('2026-11-20');
    const candidate = calendar.bounds(calendar.previousKey(currentInvoice.key));

    const invoice = payableInvoiceOf(currentInvoice, candidate, () => 55000n);

    expect(invoice.key).toBe('2026-10');
  });

  it('falls back to the current invoice once the previous one is settled', () => {
    const currentInvoice = current('2026-11-20');
    const candidate = calendar.bounds(calendar.previousKey(currentInvoice.key));

    const invoice = payableInvoiceOf(currentInvoice, candidate, () => 0n);

    expect(invoice.key).toBe('2026-11');
  });

  it('keeps the current invoice when it is the candidate', () => {
    const currentInvoice = current('2026-11-20');

    const invoice = payableInvoiceOf(currentInvoice, currentInvoice, () => 0n);

    expect(invoice.key).toBe('2026-11');
  });
});
