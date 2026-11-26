import { CycleWindow } from '@modules/spendable/valueObjects/CycleWindow';
import { InvoiceCalendar, type PlainDate } from './InvoiceCalendar';
import { openInvoiceOf, payableInvoiceOf } from './OpenInvoice';
import {
  buildInvoiceStatementFromTotals,
  invoiceStatusOf,
  type InvoiceStatementTotals,
} from './InvoiceStatement';

type InvoiceChoice = 'open' | 'previous';

type Scenario = {
  name: string;
  feChoice: InvoiceChoice;
  beChoice: InvoiceChoice;
  beKey: string;
  beStatus: string;
  beRemaining: bigint;
  today: PlainDate;
  dueDay: number;
  previous: Partial<InvoiceStatementTotals>;
  open: Partial<InvoiceStatementTotals>;
};

const totalsOf = (
  overrides: Partial<InvoiceStatementTotals>,
): InvoiceStatementTotals => ({
  chargesBeforePeriod: 0n,
  paymentsBeforePeriod: 0n,
  chargesInPeriod: 0n,
  paymentsInPeriod: 0n,
  paymentsAfterClosing: 0n,
  ...overrides,
});

const scenarios: Scenario[] = [
  {
    name: 'shows the closed invoice that still waits for payment',
    feChoice: 'previous',
    beChoice: 'previous',
    beKey: '2026-11',
    beStatus: 'closed',
    beRemaining: 214_000n,
    today: '2026-11-14',
    dueDay: 18,
    previous: { chargesInPeriod: 214_000n },
    open: { chargesInPeriod: 38_000n },
  },
  {
    name: 'shows an overdue invoice that was never paid',
    feChoice: 'previous',
    beChoice: 'previous',
    beKey: '2026-11',
    beStatus: 'overdue',
    beRemaining: 90_000n,
    today: '2026-11-14',
    dueDay: 8,
    previous: { chargesInPeriod: 90_000n },
    open: { chargesInPeriod: 38_000n },
  },
  {
    name: 'keeps the paid invoice until its due date passes',
    feChoice: 'previous',
    beChoice: 'open',
    beKey: '2026-12',
    beStatus: 'current',
    beRemaining: 38_000n,
    today: '2026-11-18',
    dueDay: 18,
    previous: { chargesInPeriod: 214_000n, paymentsAfterClosing: 214_000n },
    open: { chargesInPeriod: 38_000n },
  },
  {
    name: 'moves to the open invoice after the paid one is due',
    feChoice: 'open',
    beChoice: 'open',
    beKey: '2026-12',
    beStatus: 'current',
    beRemaining: 38_000n,
    today: '2026-11-19',
    dueDay: 18,
    previous: { chargesInPeriod: 214_000n, paymentsAfterClosing: 214_000n },
    open: { chargesInPeriod: 38_000n },
  },
  {
    name: 'keeps the paid invoice while the open cycle has nothing in it',
    feChoice: 'previous',
    beChoice: 'open',
    beKey: '2026-12',
    beStatus: 'current',
    beRemaining: 0n,
    today: '2026-11-25',
    dueDay: 18,
    previous: { chargesInPeriod: 214_000n, paymentsAfterClosing: 214_000n },
    open: {},
  },
  {
    name: 'shows the open invoice when the previous one never had anything due',
    feChoice: 'open',
    beChoice: 'open',
    beKey: '2026-12',
    beStatus: 'current',
    beRemaining: 38_000n,
    today: '2026-11-14',
    dueDay: 18,
    previous: {},
    open: { chargesInPeriod: 38_000n },
  },
];

const beInvoiceOf = (scenario: Scenario) => {
  const calendar = new InvoiceCalendar({
    dueDay: scenario.dueDay,
    closingDaysBeforeDue: 7,
  });
  const current = calendar.bounds(calendar.invoiceKeyFor(scenario.today));
  const candidate = openInvoiceOf(
    calendar,
    current,
    CycleWindow.of(scenario.today, 'monthly'),
  );
  const previous = calendar.bounds(calendar.previousKey(current.key));
  const statements = new Map([
    [current.key, buildInvoiceStatementFromTotals(totalsOf(scenario.open))],
    [
      previous.key,
      buildInvoiceStatementFromTotals(totalsOf(scenario.previous)),
    ],
  ]);
  const selected = payableInvoiceOf(
    current,
    candidate,
    (key) => statements.get(key)?.remaining ?? 0n,
  );
  const statement = statements.get(selected.key);
  if (!statement) throw new Error(`missing statement for ${selected.key}`);

  return {
    choice: selected.key === current.key ? 'open' : 'previous',
    key: selected.key,
    status: invoiceStatusOf({
      statement,
      key: selected.key,
      currentKey: current.key,
      dueDate: selected.dueDate,
      today: scenario.today,
    }),
    remaining: statement.remaining,
  };
};

describe('invoice-hero parity', () => {
  it.each(scenarios)(
    'records the invoice the BE returns for: $name',
    (scenario) => {
      expect(beInvoiceOf(scenario)).toEqual({
        choice: scenario.beChoice,
        key: scenario.beKey,
        status: scenario.beStatus,
        remaining: scenario.beRemaining,
      });
    },
  );

  it('records where the BE and the invoice hero choose different invoices', () => {
    const divergent = scenarios
      .filter((scenario) => beInvoiceOf(scenario).choice !== scenario.feChoice)
      .map(({ name }) => name);

    expect(divergent).toEqual([
      'keeps the paid invoice until its due date passes',
      'keeps the paid invoice while the open cycle has nothing in it',
    ]);
  });
});
