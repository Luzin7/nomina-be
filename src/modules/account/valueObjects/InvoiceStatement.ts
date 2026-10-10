import { InvoiceCalendar, InvoiceKey, PlainDate } from './InvoiceCalendar';

export type StatementEntryKind = 'charge' | 'payment';

export type StatementEntry = {
  date: PlainDate;
  amount: bigint;
  kind: StatementEntryKind;
};

export type InvoiceStatementInput = {
  calendar: InvoiceCalendar;
  key: InvoiceKey;
  today: PlainDate;
  entries: StatementEntry[];
};

export type InvoiceStatement = {
  previousBalance: bigint;
  charges: bigint;
  payments: bigint;
  total: bigint;
  remaining: bigint;
};

const sumOf = (entries: StatementEntry[], kind: StatementEntryKind): bigint =>
  entries
    .filter((entry) => entry.kind === kind)
    .reduce((sum, entry) => sum + entry.amount, 0n);

const balanceOf = (entries: StatementEntry[]): bigint =>
  sumOf(entries, 'charge') - sumOf(entries, 'payment');

const atLeastZero = (amount: bigint): bigint => (amount > 0n ? amount : 0n);

export const buildInvoiceStatement = ({
  calendar,
  key,
  today,
  entries,
}: InvoiceStatementInput): InvoiceStatement => {
  const { periodStart, periodEnd } = calendar.bounds(key);
  const posted = entries.filter((entry) => entry.date <= today);
  const withinPeriod = posted.filter(
    (entry) => entry.date >= periodStart && entry.date <= periodEnd,
  );
  const afterClosing = posted.filter((entry) => entry.date > periodEnd);

  const previousBalance = balanceOf(
    posted.filter((entry) => entry.date < periodStart),
  );
  const charges = sumOf(withinPeriod, 'charge');
  const payments = sumOf(withinPeriod, 'payment');
  const total = previousBalance + charges - payments;

  return {
    previousBalance,
    charges,
    payments,
    total,
    remaining: atLeastZero(total - sumOf(afterClosing, 'payment')),
  };
};
