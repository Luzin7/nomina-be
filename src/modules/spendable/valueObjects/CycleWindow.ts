import type { WorkspaceCycle } from '@constants/enums';
import type { PlainDate } from '@modules/account/valueObjects/InvoiceCalendar';

const MS_PER_DAY = 86_400_000;
const DAYS_PER_WEEK = 7;
const HALF_MONTH_LAST_DAY = 15;

type CalendarDate = { year: number; month: number; day: number };

type WindowBounds = { startDate: PlainDate; endDate: PlainDate };

const parseDate = (date: PlainDate): CalendarDate => {
  const [year, month, day] = date.split('-').map(Number);
  return { year, month, day };
};

const pad = (value: number): string => String(value).padStart(2, '0');

const toPlainDate = (date: Date): PlainDate =>
  `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;

const toUtc = (date: PlainDate): Date => {
  const { year, month, day } = parseDate(date);
  return new Date(Date.UTC(year, month - 1, day));
};

const epochDay = (date: PlainDate): number =>
  Math.round(toUtc(date).getTime() / MS_PER_DAY);

const shiftDays = (date: PlainDate, days: number): PlainDate => {
  const shifted = toUtc(date);
  shifted.setUTCDate(shifted.getUTCDate() + days);
  return toPlainDate(shifted);
};

const mondayOf = (date: PlainDate): PlainDate =>
  shiftDays(date, -((toUtc(date).getUTCDay() + 6) % 7));

const firstDayOfMonth = ({ year, month }: CalendarDate): PlainDate =>
  `${year}-${pad(month)}-01`;

const lastDayOfMonth = ({ year, month }: CalendarDate): PlainDate =>
  toPlainDate(new Date(Date.UTC(year, month, 0)));

const monthlyWindow = (today: PlainDate): WindowBounds => {
  const parsed = parseDate(today);
  return {
    startDate: firstDayOfMonth(parsed),
    endDate: lastDayOfMonth(parsed),
  };
};

const halfMonthWindow = (today: PlainDate): WindowBounds => {
  const parsed = parseDate(today);
  if (parsed.day <= HALF_MONTH_LAST_DAY) {
    return {
      startDate: firstDayOfMonth(parsed),
      endDate: `${parsed.year}-${pad(parsed.month)}-15`,
    };
  }

  return {
    startDate: `${parsed.year}-${pad(parsed.month)}-16`,
    endDate: lastDayOfMonth(parsed),
  };
};

const weeklyWindow = (today: PlainDate): WindowBounds => {
  const startDate = mondayOf(today);
  return { startDate, endDate: shiftDays(startDate, DAYS_PER_WEEK - 1) };
};

const boundsOf = (today: PlainDate, cycle: WorkspaceCycle): WindowBounds => {
  if (cycle === 'half_month') return halfMonthWindow(today);
  if (cycle === 'weekly') return weeklyWindow(today);
  return monthlyWindow(today);
};

export class CycleWindow {
  private constructor(
    private readonly from: PlainDate,
    private readonly to: PlainDate,
    private readonly remainingDays: number,
  ) {}

  static of(today: PlainDate, cycle: WorkspaceCycle): CycleWindow {
    const bounds = boundsOf(today, cycle);
    const remainingDays = epochDay(bounds.endDate) - epochDay(today) + 1;

    return new CycleWindow(
      bounds.startDate,
      bounds.endDate,
      Math.max(1, remainingDays),
    );
  }

  get startDate(): PlainDate {
    return this.from;
  }

  get endDate(): PlainDate {
    return this.to;
  }

  get daysRemaining(): number {
    return this.remainingDays;
  }

  contains(date: PlainDate): boolean {
    return date >= this.from && date <= this.to;
  }
}
