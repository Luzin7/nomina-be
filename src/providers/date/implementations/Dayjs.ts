import { Injectable } from '@nestjs/common';
import dayjs from 'dayjs';
import timezone from 'dayjs/plugin/timezone';
import utc from 'dayjs/plugin/utc';
import {
  DateProvider,
  InvoiceCycle,
  InvoiceCycleParams,
} from '../contracts/DateProvider';

dayjs.extend(utc);
dayjs.extend(timezone);

@Injectable()
export class DayJsDateProvider implements DateProvider {
  now(): Date {
    return dayjs().utc().toDate();
  }

  format(
    date: Date,
    formatStr: string,
    tz: string = 'America/Sao_Paulo',
  ): string {
    return dayjs(date).tz(tz).format(formatStr);
  }

  add(
    date: Date,
    amount: number,
    unit: 'day' | 'month' | 'year',
    tz: string = 'America/Sao_Paulo',
  ): Date {
    return dayjs(date).tz(tz).add(amount, unit).toDate();
  }

  parse(date: string | Date): Date {
    return dayjs(date).toDate();
  }

  startOfDay(date: string | Date, tz: string = 'America/Sao_Paulo'): Date {
    if (typeof date === 'string') {
      return dayjs.tz(date, tz).startOf('day').toDate();
    }
    return dayjs(date).tz(tz).startOf('day').toDate();
  }

  startOfMonth(date: string | Date, tz: string = 'America/Sao_Paulo'): Date {
    if (typeof date === 'string') {
      return dayjs.tz(date, tz).startOf('month').toDate();
    }
    return dayjs(date).tz(tz).startOf('month').toDate();
  }

  endOfMonth(date: string | Date, tz: string = 'America/Sao_Paulo'): Date {
    if (typeof date === 'string') {
      return dayjs.tz(date, tz).endOf('month').toDate();
    }
    return dayjs(date).tz(tz).endOf('month').toDate();
  }

  endOfDay(date: string | Date, tz: string = 'America/Sao_Paulo'): Date {
    if (typeof date === 'string') {
      return dayjs.tz(date, tz).endOf('day').toDate();
    }
    return dayjs(date).tz(tz).endOf('day').toDate();
  }

  toTimezone(date: Date, timezone: string): Date {
    return dayjs(date).tz(timezone).toDate();
  }

  calculateInvoiceCycle(params: InvoiceCycleParams): InvoiceCycle {
    const { referenceDate, closingDaysBeforeDue, dueDay, timezone } = params;

    const ref = dayjs(referenceDate);
    let anchor = dayjs(referenceDate).tz(timezone);

    const safeDueDay = Math.min(dueDay, anchor.daysInMonth());
    const dueDate = anchor.date(safeDueDay).startOf('day');
    const closingDate = dueDate.subtract(closingDaysBeforeDue, 'day');

    if (closingDate.isBefore(ref)) {
      anchor = anchor.add(1, 'month');
    }

    const finalSafeDueDay = Math.min(dueDay, anchor.daysInMonth());
    const finalDueDate = anchor.date(finalSafeDueDay).startOf('day');
    const finalClosingDate = finalDueDate.subtract(closingDaysBeforeDue, 'day');

    const periodEnd = finalClosingDate.endOf('day').toDate();
    const previousClosingDate = finalClosingDate.subtract(1, 'month');
    const periodStart = previousClosingDate.add(1, 'day').startOf('day').toDate();

    return {
      periodStart,
      periodEnd,
      dueDate: finalDueDate.toDate(),
    };
  }

  addDaysInCurrentDate(days: number): Date {
    return dayjs().add(days, 'day').toDate();
  }

  addYearsInCurrentDate(years: number): Date {
    return dayjs().add(years, 'year').toDate();
  }

  isBefore({
    startDate = new Date(),
    endDate,
  }: {
    startDate?: Date;
    endDate: Date;
  }): boolean {
    return dayjs(startDate).isBefore(endDate);
  }
}
