import { CreditCard } from '@modules/account/entities/CreditCardAccount';
import {
  InvoiceCalendar,
  InvoiceKey,
  PlainDate,
} from '@modules/account/valueObjects/InvoiceCalendar';
import { InvoiceStatementTotals } from '@modules/account/valueObjects/InvoiceStatement';

export type CardInvoiceWindow = {
  accountId: string;
  timezone: string;
  periodStart: PlainDate;
  periodEnd: PlainDate;
  today: PlainDate;
};

export type CardInvoiceTotals = InvoiceStatementTotals & {
  pendingCharges: bigint;
};

export const cardInvoiceWindowOf = (
  card: CreditCard,
  calendar: InvoiceCalendar,
  key: InvoiceKey,
  today: PlainDate,
): CardInvoiceWindow => {
  const { periodStart, periodEnd } = calendar.bounds(key);

  return {
    accountId: card.id,
    timezone: card.timezone,
    periodStart,
    periodEnd,
    today,
  };
};
