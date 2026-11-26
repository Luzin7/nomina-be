import { TransactionType } from '@constants/enums';
import { LastMovementPresenter } from './LastMovement.presenter';

describe('LastMovementPresenter', () => {
  it('exposes cents as decimal and the date as ISO', () => {
    expect(
      LastMovementPresenter.toHTTP({
        accountId: 'acc-1',
        transactionId: 'tx-1',
        title: 'Mercado',
        date: new Date('2026-11-20T15:00:00.000Z'),
        amountCents: 45_050,
        type: TransactionType.EXPENSE,
      }),
    ).toEqual({
      accountId: 'acc-1',
      transactionId: 'tx-1',
      title: 'Mercado',
      date: '2026-11-20T15:00:00.000Z',
      amount: 450.5,
      type: TransactionType.EXPENSE,
    });
  });
});
