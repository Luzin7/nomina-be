import { InvoiceCalendar, InvoiceKey, PlainDate } from './InvoiceCalendar';

export type InvoiceAllocationInput = {
  calendar: InvoiceCalendar;
  paymentDate: PlainDate;
  explicitTarget?: InvoiceKey;
};

/**
 * Resolve a qual fatura um pagamento pertence.
 *
 * Com alvo explícito (o botão "pagar fatura" sempre envia `month/year`), usa-o.
 * Sem alvo, ancora na fatura fechada mais recente em `paymentDate` — nunca
 * atravessa para uma fatura mais antiga nem adivinha waterfall.
 */
export const allocateInvoice = (input: InvoiceAllocationInput): InvoiceKey => {
  if (input.explicitTarget) return input.explicitTarget;

  const containingKey = input.calendar.invoiceKeyFor(input.paymentDate);
  if (input.calendar.bounds(containingKey).periodEnd === input.paymentDate) {
    return containingKey;
  }

  return input.calendar.previousKey(containingKey);
};
