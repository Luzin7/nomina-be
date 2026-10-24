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

  it('should include the description', () => {
    const transaction = makeTransaction({ description: 'Mercado do mês' });

    const result = TransactionPreviewPresenter.toHTTP(transaction);

    expect(result.description).toBe('Mercado do mês');
  });

  it('should return null description, recurring id and installment info for a plain transaction', () => {
    const result = TransactionPreviewPresenter.toHTTP(makeTransaction());

    expect(result.description).toBeNull();
    expect(result.recurringId).toBeNull();
    expect(result.installmentNumber).toBeNull();
    expect(result.installmentCount).toBeNull();
  });

  it('should include the installment position', () => {
    const transaction = makeTransaction({
      installmentGroupId: 'group-1',
      installmentNumber: 3,
      installmentCount: 10,
    });

    const result = TransactionPreviewPresenter.toHTTP(transaction);

    expect(result.installmentNumber).toBe(3);
    expect(result.installmentCount).toBe(10);
  });

  it('should include the recurring id', () => {
    const transaction = makeTransaction({ recurringId: 'rec-1' });

    const result = TransactionPreviewPresenter.toHTTP(transaction);

    expect(result.recurringId).toBe('rec-1');
  });
});
