import { CLOSING_DAYS_BEFORE_DUE_OPTIONS } from '@constants/enums';
import { updateAccountSchema } from './update-account.dto';

// Este spec importa o schema real. Antes ele redefinia uma cópia local do Zod
// (com campos que o schema real nem tem e faixas antigas de 1–31), então
// validava a cópia — nunca o código de produção.

function makeRequest(overrides: Record<string, unknown> = {}) {
  return {
    name: 'Updated Account',
    ...overrides,
  };
}

describe('UpdateAccountRequest DTO', () => {
  describe('name field', () => {
    it('should accept minimum length name (1 character)', () => {
      expect(
        updateAccountSchema.safeParse(makeRequest({ name: 'A' })).success,
      ).toBe(true);
    });

    it('should accept maximum length name (50 characters)', () => {
      expect(
        updateAccountSchema.safeParse(makeRequest({ name: 'A'.repeat(50) }))
          .success,
      ).toBe(true);
    });

    it('should reject empty name', () => {
      expect(
        updateAccountSchema.safeParse(makeRequest({ name: '' })).success,
      ).toBe(false);
    });

    it('should reject name longer than 50 characters', () => {
      expect(
        updateAccountSchema.safeParse(makeRequest({ name: 'A'.repeat(51) }))
          .success,
      ).toBe(false);
    });

    it('should trim whitespace from name', () => {
      const result = updateAccountSchema.safeParse(
        makeRequest({ name: '  My Account  ' }),
      );
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.name).toBe('My Account');
    });

    it('should reject a missing name', () => {
      expect(updateAccountSchema.safeParse({}).success).toBe(false);
    });
  });

  describe('closingDaysBeforeDue field', () => {
    it.each(CLOSING_DAYS_BEFORE_DUE_OPTIONS)('should accept %d', (option) => {
      expect(
        updateAccountSchema.safeParse(
          makeRequest({ closingDaysBeforeDue: option }),
        ).success,
      ).toBe(true);
    });

    it.each([0, 1, 4, 6, 8, 9, 11, 31])('should reject %d', (invalid) => {
      expect(
        updateAccountSchema.safeParse(
          makeRequest({ closingDaysBeforeDue: invalid }),
        ).success,
      ).toBe(false);
    });

    it('should accept null', () => {
      expect(
        updateAccountSchema.safeParse(
          makeRequest({ closingDaysBeforeDue: null }),
        ).success,
      ).toBe(true);
    });

    it('should accept the field being omitted', () => {
      expect(updateAccountSchema.safeParse(makeRequest()).success).toBe(true);
    });
  });

  describe('dueDay field', () => {
    it.each([1, 15, 28])('should accept day %d', (day) => {
      expect(
        updateAccountSchema.safeParse(makeRequest({ dueDay: day })).success,
      ).toBe(true);
    });

    it.each([0, 29, 31])('should reject day %d', (day) => {
      expect(
        updateAccountSchema.safeParse(makeRequest({ dueDay: day })).success,
      ).toBe(false);
    });

    it('should accept null', () => {
      expect(
        updateAccountSchema.safeParse(makeRequest({ dueDay: null })).success,
      ).toBe(true);
    });
  });

  describe('creditLimit field', () => {
    it('should accept a positive limit', () => {
      expect(
        updateAccountSchema.safeParse(makeRequest({ creditLimit: 500000 }))
          .success,
      ).toBe(true);
    });

    it.each([0, -1])('should reject %d', (limit) => {
      expect(
        updateAccountSchema.safeParse(makeRequest({ creditLimit: limit }))
          .success,
      ).toBe(false);
    });
  });
});
