import {
  CreditLimitExceededError,
  PaymentExceedsInvoiceBalanceError,
  ValidationAccountError,
} from '@modules/account/errors';
import { CreditCard } from './CreditCardAccount';

describe('CreditCard entity', () => {
  function makeProps(
    overrides: Partial<Parameters<typeof CreditCard.create>[0]> = {},
  ) {
    return {
      workspaceId: 'workspace-1',
      name: 'Visa Gold',
      timezone: 'America/Sao_Paulo',
      creditLimit: 5000n,
      closingDaysBeforeDue: 10,
      dueDay: 20,
      ...overrides,
    };
  }

  function makeCard(overrides = {}) {
    const result = CreditCard.create(makeProps(overrides));
    if (result.isLeft())
      throw new Error('Failed to create CreditCard: ' + result.value.message);
    return result.value;
  }

  describe('create()', () => {
    it('should create a valid credit card', () => {
      expect(CreditCard.create(makeProps()).isRight()).toBe(true);
    });

    it('should create a credit card without creditLimit (unlimited)', () => {
      expect(
        CreditCard.create(makeProps({ creditLimit: null })).isRight(),
      ).toBe(true);
    });

    it('should NOT create a credit card without closingDaysBeforeDue', () => {
      expect(
        CreditCard.create(
          makeProps({ closingDaysBeforeDue: 28 }),
        ).isLeft(),
      ).toBe(true);
    });

    it.each<[Partial<Parameters<typeof CreditCard.create>[0]>, string]>([
      [{ creditLimit: 0n }, 'zero credit limit'],
      [{ creditLimit: -100n }, 'negative credit limit'],
      [
        { closingDaysBeforeDue: 0 },
        'closingDaysBeforeDue 0',
      ],
      [
        { closingDaysBeforeDue: 32 },
        'closingDaysBeforeDue 32',
      ],
      [{ dueDay: 0 }, 'dueDay 0'],
      [{ dueDay: 32 }, 'dueDay 32'],
    ])('should reject %s', (props) => {
      const result = CreditCard.create(makeProps(props));
      expect(result.isLeft()).toBe(true);
      if (result.isLeft())
        expect(result.value).toBeInstanceOf(ValidationAccountError);
    });

    it('should default balance to 0 when not provided', () => {
      const card = makeCard();
      expect(card.balance).toBe(0n);
    });
  });

  describe('registerCharge()', () => {
    it('should increase balance', () => {
      const card = makeCard();
      card.registerCharge(1000n);
      expect(card.balance).toBe(1000n);
    });

    it('should reject zero amount', () => {
      const result = makeCard().registerCharge(0n);
      expect(result.isLeft()).toBe(true);
      if (result.isLeft())
        expect(result.value).toBeInstanceOf(ValidationAccountError);
    });

    it('should reject charge exceeding available limit', () => {
      const card = makeCard({ creditLimit: 1000n });
      const result = card.registerCharge(1500n);
      expect(result.isLeft()).toBe(true);
      if (result.isLeft())
        expect(result.value).toBeInstanceOf(CreditLimitExceededError);
    });

    it('should allow any charge when creditLimit is null (unlimited)', () => {
      const card = makeCard({ creditLimit: null });
      expect(card.registerCharge(999999999n).isRight()).toBe(true);
    });
  });

  describe('payInvoice()', () => {
    it('should decrease balance on payment', () => {
      const card = makeCard();
      card.registerCharge(500n);
      card.payInvoice(500n);
      expect(card.balance).toBe(0n);
    });

    it('should reject zero amount', () => {
      const result = makeCard().payInvoice(0n);
      expect(result.isLeft()).toBe(true);
      if (result.isLeft())
        expect(result.value).toBeInstanceOf(ValidationAccountError);
    });

    it('should reject payment exceeding current balance', () => {
      const card = makeCard();
      card.registerCharge(200n);
      const result = card.payInvoice(500n);
      expect(result.isLeft()).toBe(true);
      if (result.isLeft())
        expect(result.value).toBeInstanceOf(PaymentExceedsInvoiceBalanceError);
    });
  });

  describe('applyExpenseEffect()', () => {
    it('should behave like registerCharge() (increase balance)', () => {
      const card = makeCard();
      card.applyExpenseEffect(1000n);
      expect(card.balance).toBe(1000n);
    });

    it('should reject expense exceeding available limit', () => {
      const card = makeCard({ creditLimit: 1000n });
      const result = card.applyExpenseEffect(1500n);
      expect(result.isLeft()).toBe(true);
      if (result.isLeft())
        expect(result.value).toBeInstanceOf(CreditLimitExceededError);
    });
  });

  describe('applyIncomeEffect()', () => {
    it('should behave like payInvoice() (decrease balance)', () => {
      const card = makeCard();
      card.registerCharge(500n);
      card.applyIncomeEffect(500n);
      expect(card.balance).toBe(0n);
    });

    it('should reject income exceeding current balance', () => {
      const card = makeCard();
      card.registerCharge(200n);
      const result = card.applyIncomeEffect(500n);
      expect(result.isLeft()).toBe(true);
      if (result.isLeft())
        expect(result.value).toBeInstanceOf(PaymentExceedsInvoiceBalanceError);
    });
  });

  describe('adjustLimit()', () => {
    it('should update credit limit', () => {
      const card = makeCard();
      card.adjustLimit(10000n);
      expect(card.creditLimit).toBe(10000n);
    });

    it('should reject zero or negative limit', () => {
      const zeroResult = makeCard().adjustLimit(0n);
      expect(zeroResult.isLeft()).toBe(true);
      if (zeroResult.isLeft())
        expect(zeroResult.value).toBeInstanceOf(ValidationAccountError);

      expect(makeCard().adjustLimit(-500n).isLeft()).toBe(true);
    });
  });
});
