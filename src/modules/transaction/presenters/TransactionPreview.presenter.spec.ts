import { makeTransaction } from '@modules/transaction/test-helpers/mock-factories';

import { TransactionPreviewPresenter } from './TransactionPreview.presenter';

describe('TransactionPreviewPresenter', () => {
  it('should include both account ids for a transfer', () => {
    const transaction = makeTransaction({
      type: 'TRANSFER',
      accountId: 'acc-1',
      destinationAccountId: 'acc-2',
    });

    const result = TransactionPreviewPresenter.toHTTP(transaction);

    expect(result.accountId).toBe('acc-1');
    expect(result.destinationAccountId).toBe('acc-2');
  });

  it('should include the account id and a null destination for an expense', () => {
    const transaction = makeTransaction({
      type: 'EXPENSE',
      accountId: 'acc-1',
    });

    const result = TransactionPreviewPresenter.toHTTP(transaction);

    expect(result.accountId).toBe('acc-1');
    expect(result.destinationAccountId).toBeNull();
  });
});
