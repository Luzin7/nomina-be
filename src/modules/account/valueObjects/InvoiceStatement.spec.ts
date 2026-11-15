import { InvoiceCalendar } from './InvoiceCalendar';
import { CardInvoiceTotals } from './CardInvoiceWindow';
import {
  buildInvoiceStatement,
  buildInvoiceStatementFromTotals,
} from './InvoiceStatement';

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

const makeTotals = (
  overrides: Partial<CardInvoiceTotals> = {},
): CardInvoiceTotals => ({
  chargesBeforePeriod: 0n,
  paymentsBeforePeriod: 0n,
  chargesInPeriod: 0n,
  paymentsInPeriod: 0n,
  paymentsAfterClosing: 0n,
  pendingCharges: 0n,
  ...overrides,
});

describe('buildInvoiceStatementFromTotals', () => {
  it('carries the balance of charges and payments before the period', () => {
    expect(
      buildInvoiceStatementFromTotals(
        makeTotals({ chargesBeforePeriod: 1000n, paymentsBeforePeriod: 400n }),
      ),
    ).toEqual({
      previousBalance: 600n,
      charges: 0n,
      payments: 0n,
      total: 600n,
      remaining: 600n,
    });
  });

  it('adds charges and subtracts payments inside the period', () => {
    expect(
      buildInvoiceStatementFromTotals(
        makeTotals({ chargesInPeriod: 5000n, paymentsInPeriod: 1500n }),
      ),
    ).toEqual({
      previousBalance: 0n,
      charges: 5000n,
      payments: 1500n,
      total: 3500n,
      remaining: 3500n,
    });
  });

  it('adds the previous balance to the period total', () => {
    expect(
      buildInvoiceStatementFromTotals(
        makeTotals({
          chargesBeforePeriod: 1000n,
          paymentsBeforePeriod: 400n,
          chargesInPeriod: 600n,
          paymentsInPeriod: 100n,
        }),
      ),
    ).toEqual({
      previousBalance: 600n,
      charges: 600n,
      payments: 100n,
      total: 1100n,
      remaining: 1100n,
    });
  });

  it('subtracts payments after closing from the remaining only', () => {
    expect(
      buildInvoiceStatementFromTotals(
        makeTotals({ chargesInPeriod: 5000n, paymentsAfterClosing: 2000n }),
      ),
    ).toEqual({
      previousBalance: 0n,
      charges: 5000n,
      payments: 0n,
      total: 5000n,
      remaining: 3000n,
    });
  });

  it('clamps the remaining to zero when payments exceed the total', () => {
    expect(
      buildInvoiceStatementFromTotals(
        makeTotals({ chargesInPeriod: 5000n, paymentsAfterClosing: 7000n }),
      ).remaining,
    ).toBe(0n);
  });

  it('ignores pending charges', () => {
    expect(
      buildInvoiceStatementFromTotals(
        makeTotals({ chargesInPeriod: 5000n, pendingCharges: 900n }),
      ),
    ).toEqual({
      previousBalance: 0n,
      charges: 5000n,
      payments: 0n,
      total: 5000n,
      remaining: 5000n,
    });
  });

  it('returns zeros for a card without totals', () => {
    expect(buildInvoiceStatementFromTotals(makeTotals())).toEqual({
      previousBalance: 0n,
      charges: 0n,
      payments: 0n,
      total: 0n,
      remaining: 0n,
    });
  });
});
