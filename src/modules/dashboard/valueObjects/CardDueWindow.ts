import { isValidClosingDaysBeforeDue, isValidDueDay } from '@constants/enums';
import type { CreditCard } from '@modules/account/entities/CreditCardAccount';
import { InvoiceCalendar } from '@modules/account/valueObjects/InvoiceCalendar';
import { calendarDaysBetween, monthKeyOf } from './PlainDates';

export const DUE_WINDOW_LAST_DAY = 6;

export type CardDueInWindow = {
  card: CreditCard;
  year: number;
  month: number;
  days: number;
};

const isInWindow = (days: number): boolean =>
  days >= 0 && days <= DUE_WINDOW_LAST_DAY;

export function findCardDueInWindow(
  card: CreditCard,
  today: string,
): CardDueInWindow | null {
  if (
    !isValidDueDay(card.dueDay) ||
    !isValidClosingDaysBeforeDue(card.closingDaysBeforeDue)
  ) {
    return null;
  }

  const calendar = new InvoiceCalendar({
    dueDay: card.dueDay,
    closingDaysBeforeDue: card.closingDaysBeforeDue,
  });

  for (const key of [monthKeyOf(today, 0), monthKeyOf(today, 1)]) {
    const days = calendarDaysBetween(today, calendar.bounds(key).dueDate);
    if (!isInWindow(days)) continue;

    const [year, month] = key.split('-').map(Number);
    return { card, year, month, days };
  }

  return null;
}
