import { BadRequestException } from '@nestjs/common';
import {
  UpdateRecurringTransactionPipe,
  updateRecurringTransactionSchema,
} from './update-recurring-transaction.dto';

describe('UpdateRecurringTransactionRequest DTO', () => {
  const ACCOUNT_ID = '123e4567-e89b-12d3-a456-426614174000';

  it('accepts accountId', () => {
    const result = updateRecurringTransactionSchema.safeParse({
      accountId: ACCOUNT_ID,
    });

    expect(result.success).toBe(true);
  });

  it('rejects a non-uuid accountId', () => {
    const result = updateRecurringTransactionSchema.safeParse({
      accountId: 'not-a-uuid',
    });

    expect(result.success).toBe(false);
  });

  it('rejects unknown keys instead of silently dropping them', () => {
    expect(() =>
      UpdateRecurringTransactionPipe.transform({ active: false }),
    ).toThrow(BadRequestException);
  });
});
