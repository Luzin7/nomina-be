import { daysInMonth } from '@utils/calendarMonth';

export type CalendarDate = {
  year: number;
  month: number;
  day: number;
};

const clampDay = (year: number, month: number, dayOfMonth: number): number =>
  Math.min(dayOfMonth, daysInMonth(year, month));

export const nextStrictlyFutureOccurrence = (
  today: CalendarDate,
  dayOfMonth: number,
): CalendarDate => {
  const clampedDay = clampDay(today.year, today.month, dayOfMonth);
  if (clampedDay > today.day) {
    return { year: today.year, month: today.month, day: clampedDay };
  }

  const year = today.month === 12 ? today.year + 1 : today.year;
  const month = today.month === 12 ? 1 : today.month + 1;

  return { year, month, day: clampDay(year, month, dayOfMonth) };
};
