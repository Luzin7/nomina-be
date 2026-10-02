import { isValidClosingDaysBeforeDue, isValidDueDay } from '@constants/enums';
import { ValidationAccountError } from '@modules/account/errors';

export type PlainDate = string;
export type InvoiceKey = string;

export type CreditCardCycle = {
  dueDay: number;
  closingDaysBeforeDue: number;
};

export type InvoiceBounds = {
  key: InvoiceKey;
  periodStart: PlainDate;
  endExclusive: PlainDate;
  periodEnd: PlainDate;
  dueDate: PlainDate;
};

const pad = (value: number): string => String(value).padStart(2, '0');

const toPlainDate = (year: number, month: number, day: number): PlainDate =>
  `${year}-${pad(month)}-${pad(day)}`;

const parseDate = (
  date: PlainDate,
): { year: number; month: number; day: number } => {
  const [year, month, day] = date.split('-').map(Number);
  return { year, month, day };
};

const parseKey = (key: InvoiceKey): { year: number; month: number } => {
  const [year, month] = key.split('-').map(Number);
  return { year, month };
};

const daysInMonth = (year: number, month: number): number =>
  new Date(Date.UTC(year, month, 0)).getUTCDate();

const shiftMonth = (
  year: number,
  month: number,
  delta: number,
): { year: number; month: number } => {
  const index = year * 12 + (month - 1) + delta;
  return { year: Math.floor(index / 12), month: (index % 12) + 1 };
};

const addDays = (date: PlainDate, days: number): PlainDate => {
  const { year, month, day } = parseDate(date);
  const next = new Date(Date.UTC(year, month - 1, day + days));
  return toPlainDate(
    next.getUTCFullYear(),
    next.getUTCMonth() + 1,
    next.getUTCDate(),
  );
};

export class InvoiceCalendar {
  private readonly dueDay: number;
  private readonly closingDaysBeforeDue: number;

  constructor(cycle: CreditCardCycle) {
    if (!isValidDueDay(cycle.dueDay)) {
      throw new ValidationAccountError('O dia de vencimento é inválido.');
    }
    if (!isValidClosingDaysBeforeDue(cycle.closingDaysBeforeDue)) {
      throw new ValidationAccountError(
        'A distância entre fechamento e vencimento é inválida.',
      );
    }

    this.dueDay = cycle.dueDay;
    this.closingDaysBeforeDue = cycle.closingDaysBeforeDue;
  }

  invoiceKeyFor(date: PlainDate): InvoiceKey {
    const threshold = addDays(date, this.closingDaysBeforeDue);
    const { year, month } = parseDate(threshold);

    const sameMonthDue = this.dueOf(year, month);
    if (sameMonthDue >= threshold) return this.keyFromDue(sameMonthDue);

    const next = shiftMonth(year, month, 1);
    return this.keyFromDue(this.dueOf(next.year, next.month));
  }

  previousKey(key: InvoiceKey): InvoiceKey {
    const { year, month } = parseKey(key);
    const previous = shiftMonth(year, month, -1);
    return `${previous.year}-${pad(previous.month)}`;
  }

  bounds(key: InvoiceKey): InvoiceBounds {
    const { year, month } = parseKey(key);
    const dueDate = this.dueOf(year, month);

    const previousRef = shiftMonth(year, month, -1);
    const previousClosing = this.closingOf(
      this.dueOf(previousRef.year, previousRef.month),
    );
    const closing = this.closingOf(dueDate);

    return {
      key,
      periodStart: addDays(previousClosing, 1),
      endExclusive: addDays(closing, 1),
      periodEnd: closing,
      dueDate,
    };
  }

  private dueOf(year: number, month: number): PlainDate {
    const day = Math.min(this.dueDay, daysInMonth(year, month));
    return toPlainDate(year, month, day);
  }

  private closingOf(due: PlainDate): PlainDate {
    return addDays(due, -this.closingDaysBeforeDue);
  }

  private keyFromDue(due: PlainDate): InvoiceKey {
    const { year, month } = parseDate(due);
    return `${year}-${pad(month)}`;
  }
}
