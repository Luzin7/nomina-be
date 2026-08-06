export type InvoiceCycleParams = {
  referenceDate: Date;
  closingDaysBeforeDue: number;
  dueDay: number;
  timezone: string;
};

export type InvoiceCycle = {
  periodStart: Date;
  periodEnd: Date;
  dueDate: Date;
};

export abstract class DateProvider {
  abstract now(): Date;
  abstract add(
    date: Date,
    amount: number,
    unit: 'day' | 'month' | 'year',
    timezone: string,
  ): Date;

  abstract format(date: Date, formatString: string, timezone: string): string;
  abstract toTimezone(date: Date, timezone: string): Date;
  abstract calculateInvoiceCycle(params: InvoiceCycleParams): InvoiceCycle;
  abstract addDaysInCurrentDate(days: number): Date;
  abstract parse(date: string | Date): Date;
  abstract startOfDay(date: string | Date, tz?: string): Date;
  abstract endOfDay(date: string | Date, tz?: string): Date;
  abstract startOfMonth(date: string | Date, tz?: string): Date;
  abstract endOfMonth(date: string | Date, tz?: string): Date;
}
