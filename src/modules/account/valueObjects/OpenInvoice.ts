import type {
  InvoiceBounds,
  InvoiceCalendar,
  InvoiceKey,
  PlainDate,
} from './InvoiceCalendar';

export type InvoiceDueWindow = { contains(date: PlainDate): boolean };

export const openInvoiceOf = (
  calendar: InvoiceCalendar,
  current: InvoiceBounds,
  window: InvoiceDueWindow,
): InvoiceBounds =>
  window.contains(current.dueDate)
    ? current
    : calendar.bounds(calendar.previousKey(current.key));

export const payableInvoiceOf = (
  current: InvoiceBounds,
  candidate: InvoiceBounds,
  remainingOf: (key: InvoiceKey) => bigint,
): InvoiceBounds => {
  if (candidate.key === current.key) return current;

  return remainingOf(candidate.key) > 0n ? candidate : current;
};
