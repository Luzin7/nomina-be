import { BadRequestException } from '@nestjs/common';
import { PayCreditCardInvoicePipe } from './pay-credit-card-invoice.dto';

const SOURCE_ACCOUNT_ID = '0d19bbf8-b66a-4cc2-9c7c-3fcd961f06b1';

function makeRequest(overrides: Record<string, unknown> = {}) {
  return {
    sourceAccountId: SOURCE_ACCOUNT_ID,
    amount: 10_000,
    ...overrides,
  };
}

describe('PayCreditCardInvoiceRequest DTO', () => {
  it('should accept a valid payload', () => {
    expect(PayCreditCardInvoicePipe.transform(makeRequest())).toMatchObject({
      amount: 10_000,
    });
  });

  it('should reject a fractional amount as a validation error', () => {
    expect(() =>
      PayCreditCardInvoicePipe.transform(makeRequest({ amount: 1.5 })),
    ).toThrow(BadRequestException);
  });
});
