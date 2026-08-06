import { AccountType } from '@constants/enums';
import { z } from 'zod';

const updateAccountSchema = z.object({
  accountId: z.string().uuid('Invalid account ID'),
  name: z
    .string()
    .trim()
    .min(1, 'Name is required')
    .max(50, 'Name is too long'),
  type: z.nativeEnum(AccountType),
  icon: z.string().trim().nullable(),
  color: z
    .string()
    .trim()
    .regex(/^#[0-9A-Fa-f]{6}$/, 'Invalid color (use format #RRGGBB)')
    .nullable(),
  closingDaysBeforeDue: z.number().int().min(1).max(31).nullable(),
  dueDay: z.number().int().min(1).max(31).nullable(),
});

const validBase = {
  accountId: '123e4567-e89b-12d3-a456-426614174000',
  name: 'Updated Account',
  type: AccountType.CHECKING,
  icon: null,
  color: null,
  closingDaysBeforeDue: null,
  dueDay: null,
};

describe('UpdateAccountRequest DTO', () => {
  describe('accountId field', () => {
    it('should accept a valid UUID', () => {
      const result = updateAccountSchema.safeParse(validBase);
      expect(result.success).toBe(true);
    });

    it('should reject a non-UUID accountId', () => {
      const result = updateAccountSchema.safeParse({
        ...validBase,
        accountId: 'not-a-uuid',
      });
      expect(result.success).toBe(false);
    });

    it('should reject missing accountId', () => {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { accountId: _, ...without } = validBase;
      const result = updateAccountSchema.safeParse(without);
      expect(result.success).toBe(false);
    });
  });

  describe('name field', () => {
    it('should accept minimum length name (1 character)', () => {
      const result = updateAccountSchema.safeParse({
        ...validBase,
        name: 'A',
      });
      expect(result.success).toBe(true);
    });

    it('should accept maximum length name (50 characters)', () => {
      const result = updateAccountSchema.safeParse({
        ...validBase,
        name: 'A'.repeat(50),
      });
      expect(result.success).toBe(true);
    });

    it('should reject empty name', () => {
      const result = updateAccountSchema.safeParse({ ...validBase, name: '' });
      expect(result.success).toBe(false);
    });

    it('should reject name longer than 50 characters', () => {
      const result = updateAccountSchema.safeParse({
        ...validBase,
        name: 'A'.repeat(51),
      });
      expect(result.success).toBe(false);
    });

    it('should trim whitespace from name', () => {
      const result = updateAccountSchema.safeParse({
        ...validBase,
        name: '  My Account  ',
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.name).toBe('My Account');
      }
    });
  });

  describe('type field', () => {
    it.each(Object.values(AccountType))(
      'should accept AccountType.%s',
      (type) => {
        const result = updateAccountSchema.safeParse({ ...validBase, type });
        expect(result.success).toBe(true);
      },
    );

    it('should reject invalid type string', () => {
      const result = updateAccountSchema.safeParse({
        ...validBase,
        type: 'WALLET',
      });
      expect(result.success).toBe(false);
    });
  });

  describe('icon field (nullable)', () => {
    it('should accept a string icon', () => {
      const result = updateAccountSchema.safeParse({
        ...validBase,
        icon: 'wallet',
      });
      expect(result.success).toBe(true);
    });

    it('should accept null icon', () => {
      const result = updateAccountSchema.safeParse({
        ...validBase,
        icon: null,
      });
      expect(result.success).toBe(true);
    });
  });

  describe('color field (nullable)', () => {
    it('should accept a valid hex color', () => {
      const result = updateAccountSchema.safeParse({
        ...validBase,
        color: '#AABBCC',
      });
      expect(result.success).toBe(true);
    });

    it('should accept null color', () => {
      const result = updateAccountSchema.safeParse({
        ...validBase,
        color: null,
      });
      expect(result.success).toBe(true);
    });

    it('should reject invalid hex format', () => {
      const result = updateAccountSchema.safeParse({
        ...validBase,
        color: 'red',
      });
      expect(result.success).toBe(false);
    });
  });

  describe('closingDaysBeforeDue field (nullable)', () => {
    it('should accept day 1 (boundary)', () => {
      const result = updateAccountSchema.safeParse({
        ...validBase,
        closingDaysBeforeDue: 1,
      });
      expect(result.success).toBe(true);
    });

    it('should accept day 31 (boundary)', () => {
      const result = updateAccountSchema.safeParse({
        ...validBase,
        closingDaysBeforeDue: 31,
      });
      expect(result.success).toBe(true);
    });

    it('should accept null', () => {
      const result = updateAccountSchema.safeParse({
        ...validBase,
        closingDaysBeforeDue: null,
      });
      expect(result.success).toBe(true);
    });

    it('should reject day 0', () => {
      const result = updateAccountSchema.safeParse({
        ...validBase,
        closingDaysBeforeDue: 0,
      });
      expect(result.success).toBe(false);
    });

    it('should reject day 32', () => {
      const result = updateAccountSchema.safeParse({
        ...validBase,
        closingDaysBeforeDue: 32,
      });
      expect(result.success).toBe(false);
    });
  });

  describe('dueDay field (nullable)', () => {
    it('should accept day 10 (valid mid-range)', () => {
      const result = updateAccountSchema.safeParse({
        ...validBase,
        dueDay: 10,
      });
      expect(result.success).toBe(true);
    });

    it('should accept null', () => {
      const result = updateAccountSchema.safeParse({
        ...validBase,
        dueDay: null,
      });
      expect(result.success).toBe(true);
    });

    it('should reject day 0', () => {
      const result = updateAccountSchema.safeParse({
        ...validBase,
        dueDay: 0,
      });
      expect(result.success).toBe(false);
    });
  });
});
