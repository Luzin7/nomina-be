import { SYSTEM_CATEGORY } from './system-categories';

describe('SYSTEM_CATEGORY', () => {
  it('names the transfer category', () => {
    expect(SYSTEM_CATEGORY.TRANSFER.name).toBe('Transferência');
  });

  it('names the credit card payment category', () => {
    expect(SYSTEM_CATEGORY.CREDIT_CARD_PAYMENT.name).toBe('Cartão de Crédito');
  });

  it('keeps the transfer id unchanged', () => {
    expect(SYSTEM_CATEGORY.TRANSFER.id).toBe(
      '19323ba9-e496-4db9-9c22-b2a5c7cb790e',
    );
  });

  it('keeps the credit card payment id unchanged', () => {
    expect(SYSTEM_CATEGORY.CREDIT_CARD_PAYMENT.id).toBe(
      '0d19bbf8-b66a-4cc2-9c7c-3fcd961f06b1',
    );
  });
});
