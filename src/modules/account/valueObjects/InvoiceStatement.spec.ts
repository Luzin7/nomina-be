import { InvoiceCalendar } from './InvoiceCalendar';
import { buildInvoiceStatement } from './InvoiceStatement';

const calendar = new InvoiceCalendar({ dueDay: 15, closingDaysBeforeDue: 5 });

const charge = (date: string, amount: bigint) => ({
  date,
  amount,
  kind: 'charge' as const,
});

const payment = (date: string, amount: bigint) => ({
  date,
  amount,
  kind: 'payment' as const,
});

describe('buildInvoiceStatement', () => {
  it('treats the open invoice as the statement so far', () => {
    const statement = buildInvoiceStatement({
      calendar,
      key: '2026-11',
      today: '2026-10-20',
      entries: [
        charge('2026-08-20', 1000n),
        payment('2026-09-12', 1000n),
        charge('2026-10-15', 400n),
      ],
    });

    expect(statement).toMatchObject({
      previousBalance: 0n,
      charges: 400n,
      payments: 0n,
      total: 400n,
      remaining: 400n,
    });
  });

  it('settles a closed invoice with a payment made after its closing', () => {
    const statement = buildInvoiceStatement({
      calendar,
      key: '2026-09',
      today: '2026-09-20',
      entries: [charge('2026-08-20', 1000n), payment('2026-09-12', 1000n)],
    });

    expect(statement.total).toBe(1000n);
    expect(statement.remaining).toBe(0n);
  });

  it('credits an advance payment to the invoice whose period contains it', () => {
    const statement = buildInvoiceStatement({
      calendar,
      key: '2026-10',
      today: '2026-10-20',
      entries: [
        charge('2026-08-20', 1000n),
        payment('2026-09-12', 1000n),
        charge('2026-09-20', 600n),
        payment('2026-09-25', 300n),
      ],
    });

    expect(statement).toMatchObject({
      previousBalance: 1000n,
      charges: 600n,
      payments: 1300n,
      total: 300n,
      remaining: 300n,
    });
  });

  it('never reports a negative remaining when payments exceed the invoice', () => {
    const statement = buildInvoiceStatement({
      calendar,
      key: '2026-09',
      today: '2026-09-20',
      entries: [charge('2026-08-20', 1000n), payment('2026-09-12', 1300n)],
    });

    expect(statement.remaining).toBe(0n);
  });

  it('carries an unpaid balance into the next invoice', () => {
    const statement = buildInvoiceStatement({
      calendar,
      key: '2026-10',
      today: '2026-10-20',
      entries: [charge('2026-08-20', 1000n), charge('2026-09-20', 600n)],
    });

    expect(statement.previousBalance).toBe(1000n);
    expect(statement.total).toBe(1600n);
  });

  it('deducts payments made after its closing from the remaining', () => {
    const statement = buildInvoiceStatement({
      calendar,
      key: '2026-10',
      today: '2026-10-20',
      entries: [
        charge('2026-08-20', 1000n),
        charge('2026-09-20', 600n),
        payment('2026-10-12', 1200n),
      ],
    });

    expect(statement.total).toBe(1600n);
    expect(statement.remaining).toBe(400n);
  });
});
