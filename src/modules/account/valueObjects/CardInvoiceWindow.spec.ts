import { makeCreditCard } from '@modules/account/test-helpers/mock-factories';
import { cardInvoiceWindowOf } from './CardInvoiceWindow';
import { InvoiceCalendar } from './InvoiceCalendar';

describe('cardInvoiceWindowOf', () => {
  it('bounds the window by the period of the invoice key', () => {
    const card = makeCreditCard({ id: 'card-1', dueDay: 15 });
    const calendar = new InvoiceCalendar({
      dueDay: 15,
      closingDaysBeforeDue: 5,
    });

    expect(
      cardInvoiceWindowOf(card, calendar, '2026-10', '2026-10-20'),
    ).toEqual({
      accountId: 'card-1',
      timezone: 'America/Sao_Paulo',
      periodStart: '2026-09-11',
      periodEnd: '2026-10-10',
      today: '2026-10-20',
    });
  });
});
