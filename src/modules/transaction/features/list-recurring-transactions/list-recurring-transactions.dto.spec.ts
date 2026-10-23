import { RecurringKind } from '@constants/enums';
import { BadRequestException } from '@nestjs/common';
import { ListRecurringTransactionsPipe } from './list-recurring-transactions.dto';

describe('ListRecurringTransactionsPipe kind', () => {
  it('should accept installment', () => {
    expect(
      ListRecurringTransactionsPipe.transform({ kind: 'installment' }),
    ).toMatchObject({
      kind: RecurringKind.INSTALLMENT,
    });
  });

  it('should accept recurring', () => {
    expect(
      ListRecurringTransactionsPipe.transform({ kind: 'recurring' }),
    ).toMatchObject({
      kind: RecurringKind.RECURRING,
    });
  });

  it('should leave kind undefined when absent', () => {
    expect(ListRecurringTransactionsPipe.transform({}).kind).toBeUndefined();
  });

  it('should reject an invalid kind', () => {
    expect(() =>
      ListRecurringTransactionsPipe.transform({ kind: 'subscription' }),
    ).toThrow(BadRequestException);
  });
});
