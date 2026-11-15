import { ListTransactionTotalsPipe } from './list-transaction-totals.dto';

describe('ListTransactionTotalsPipe', () => {
  it('accepts an empty query', () => {
    expect(ListTransactionTotalsPipe.transform({})).toEqual({});
  });

  it('accepts every filter of the list query', () => {
    const query = {
      startDate: '2026-02-01',
      endDate: '2026-02-28',
      type: 'EXPENSE',
      status: 'COMPLETED',
      categoryId: '5f0f6b52-1b2a-4a58-9d2f-0b6f3a3c1c11',
      accountId: '5f0f6b52-1b2a-4a58-9d2f-0b6f3a3c1c12',
      title: 'rent',
    };

    expect(ListTransactionTotalsPipe.transform(query)).toEqual(query);
  });

  it('does not apply pagination defaults', () => {
    const parsed = ListTransactionTotalsPipe.transform({});

    expect(parsed).not.toHaveProperty('page');
    expect(parsed).not.toHaveProperty('pageSize');
  });

  it('rejects a malformed date', () => {
    expect(() =>
      ListTransactionTotalsPipe.transform({ startDate: '01/02/2026' }),
    ).toThrow();
  });
});
