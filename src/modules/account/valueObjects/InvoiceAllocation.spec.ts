import { allocateInvoice } from './InvoiceAllocation';
import { InvoiceCalendar } from './InvoiceCalendar';

const calendarOf = (dueDay: number, closingDaysBeforeDue: number) =>
  new InvoiceCalendar({ dueDay, closingDaysBeforeDue });

describe('allocateInvoice', () => {
  it('uses the explicit target when the client provides one', () => {
    const key = allocateInvoice({
      calendar: calendarOf(7, 7),
      paymentDate: '2026-09-02',
      explicitTarget: '2026-11',
    });

    expect(key).toBe('2026-11');
  });

  it('anchors on the most recently closed invoice when no target is given', () => {
    const key = allocateInvoice({
      calendar: calendarOf(7, 7),
      paymentDate: '2026-09-02',
    });

    expect(key).toBe('2026-09');
  });

  it('anchors on the closing invoice on its own closing day', () => {
    const key = allocateInvoice({
      calendar: calendarOf(7, 7),
      paymentDate: '2026-08-31',
    });

    expect(key).toBe('2026-09');
  });

  it('never advances to the open invoice while it is still accumulating', () => {
    const key = allocateInvoice({
      calendar: calendarOf(7, 7),
      paymentDate: '2026-09-15',
    });

    expect(key).toBe('2026-09');
  });

  it('falls back to the previous invoice when the current one has not closed', () => {
    const key = allocateInvoice({
      calendar: calendarOf(15, 5),
      paymentDate: '2024-08-05',
    });

    expect(key).toBe('2024-07');
  });
});
