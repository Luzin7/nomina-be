import { makeRecurring } from '../test-helpers/mock-factories';
import { RecurringTransactionPresenter } from './RecurringTransaction.presenter';

describe('RecurringTransactionPresenter', () => {
  it('should expose the installment count', () => {
    const http = RecurringTransactionPresenter.toHTTP(
      makeRecurring({ installmentCount: 10 }),
    );

    expect(http.installmentCount).toBe(10);
  });

  it('should expose a null installment count for a plain recurrence', () => {
    const http = RecurringTransactionPresenter.toHTTP(makeRecurring());

    expect(http.installmentCount).toBeNull();
  });
});
