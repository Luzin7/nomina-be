import * as schema from '@infra/databases/drizzle/schema';
import { makeRecurring } from '@modules/transaction/test-helpers/mock-factories';
import { RecurringTransactionMapper } from './recurring-transaction.mapper';

type Row = typeof schema.recurringTransactions.$inferSelect;

function makeRow(overrides: Partial<Row> = {}): Row {
  return {
    id: 'rec-1',
    workspaceId: 'ws-1',
    accountId: 'acc-1',
    destinationAccountId: null,
    categoryId: 'cat-1',
    type: 'EXPENSE',
    title: 'Notebook',
    description: null,
    amount: 10000,
    frequency: 'MONTHLY',
    interval: 1,
    installmentCount: null,
    startDate: new Date('2099-01-01'),
    endDate: null,
    lastGenerated: null,
    active: true,
    ...overrides,
  };
}

describe('RecurringTransactionMapper installmentCount', () => {
  it('should restore the installment count from the row', () => {
    const domain = RecurringTransactionMapper.toDomain(
      makeRow({ installmentCount: 6 }),
    );

    expect(domain.installmentCount).toBe(6);
  });

  it('should restore a null installment count', () => {
    const domain = RecurringTransactionMapper.toDomain(makeRow());

    expect(domain.installmentCount).toBeNull();
  });

  it('should write the installment count to the database shape', () => {
    const entity = makeRecurring({ installmentCount: 4 });

    expect(RecurringTransactionMapper.toDatabase(entity).installmentCount).toBe(
      4,
    );
  });
});
