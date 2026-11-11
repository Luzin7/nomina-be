import {
  InvoiceCalendar,
  PlainDate,
} from '@modules/account/valueObjects/InvoiceCalendar';
import { CardCycleNotConfiguredError } from '@modules/card-cycle/errors';

export type CardCycleWindowRecord = {
  dueDate: PlainDate;
  periodStart: PlainDate;
  periodEnd: PlainDate;
  dueDay: number;
  closingDaysBeforeDue: number;
};

export type CardCycleWindowInput = {
  dueDate: PlainDate;
  dueDay: number | null;
  closingDaysBeforeDue: number;
};

export class CardCycleWindow {
  private constructor(private readonly record: CardCycleWindowRecord) {}

  static create(input: CardCycleWindowInput): CardCycleWindow {
    if (input.dueDay === null) throw new CardCycleNotConfiguredError();

    const calendar = new InvoiceCalendar({
      dueDay: input.dueDay,
      closingDaysBeforeDue: input.closingDaysBeforeDue,
    });
    const bounds = calendar.bounds(input.dueDate.slice(0, 7));

    return new CardCycleWindow({
      dueDate: bounds.dueDate,
      periodStart: bounds.periodStart,
      periodEnd: bounds.periodEnd,
      dueDay: input.dueDay,
      closingDaysBeforeDue: input.closingDaysBeforeDue,
    });
  }

  get dueDate(): PlainDate {
    return this.record.dueDate;
  }

  get periodStart(): PlainDate {
    return this.record.periodStart;
  }

  get periodEnd(): PlainDate {
    return this.record.periodEnd;
  }

  get dueDay(): number {
    return this.record.dueDay;
  }

  get closingDaysBeforeDue(): number {
    return this.record.closingDaysBeforeDue;
  }

  contains(date: PlainDate): boolean {
    return date >= this.record.periodStart && date <= this.record.periodEnd;
  }

  toRecord(): CardCycleWindowRecord {
    return { ...this.record };
  }
}
