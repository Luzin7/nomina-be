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

const atLeastZero = (amount: bigint): bigint => (amount > 0n ? amount : 0n);

export type InvoiceStatementTotals = {
  chargesBeforePeriod: bigint;
  paymentsBeforePeriod: bigint;
  chargesInPeriod: bigint;
  paymentsInPeriod: bigint;
  paymentsAfterClosing: bigint;
};

export const buildInvoiceStatementFromTotals = ({
  chargesBeforePeriod,
  paymentsBeforePeriod,
  chargesInPeriod,
  paymentsInPeriod,
  paymentsAfterClosing,
}: InvoiceStatementTotals): InvoiceStatement => {
  const previousBalance = chargesBeforePeriod - paymentsBeforePeriod;
  const total = previousBalance + chargesInPeriod - paymentsInPeriod;

  return {
    previousBalance,
    charges: chargesInPeriod,
    payments: paymentsInPeriod,
    total,
    remaining: atLeastZero(total - paymentsAfterClosing),
  };
};

export const buildInvoiceStatement = ({
  calendar,
  key,
  today,
  entries,
}: InvoiceStatementInput): InvoiceStatement => {
  const { periodStart, periodEnd } = calendar.bounds(key);
  const posted = entries.filter((entry) => entry.date <= today);
  const beforePeriod = posted.filter((entry) => entry.date < periodStart);
  const withinPeriod = posted.filter(
    (entry) => entry.date >= periodStart && entry.date <= periodEnd,
  );
  const afterClosing = posted.filter((entry) => entry.date > periodEnd);

  return buildInvoiceStatementFromTotals({
    chargesBeforePeriod: sumOf(beforePeriod, 'charge'),
    paymentsBeforePeriod: sumOf(beforePeriod, 'payment'),
    chargesInPeriod: sumOf(withinPeriod, 'charge'),
    paymentsInPeriod: sumOf(withinPeriod, 'payment'),
    paymentsAfterClosing: sumOf(afterClosing, 'payment'),
  });
};

export type InvoiceStatus = 'current' | 'closed' | 'overdue' | 'paid';

export type InvoiceStatusInput = {
  statement: InvoiceStatement;
  key: InvoiceKey;
  currentKey: InvoiceKey;
  dueDate: PlainDate;
  today: PlainDate;
};

export const invoiceStatusOf = ({
  statement,
  key,
  currentKey,
  dueDate,
  today,
}: InvoiceStatusInput): InvoiceStatus => {
  const hadAmountDue = statement.previousBalance > 0n || statement.charges > 0n;
  if (hadAmountDue && statement.remaining === 0n) return 'paid';
  if (key === currentKey) return 'current';
  if (dueDate < today) return 'overdue';
  return 'closed';
};
