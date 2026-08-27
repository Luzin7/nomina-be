import { TransactionStatus } from '@constants/enums';
import { Transaction } from '@modules/transaction/entities/Transaction';

export function makeTransaction(
  overrides: Partial<Parameters<typeof Transaction.create>[0]> & {
    id?: string;
  } = {},
): Transaction {
  const { id, ...props } = overrides;
  const r = Transaction.create(
    {
      workspaceId: 'ws-1',
      accountId: 'acc-1',
      categoryId: 'cat-1',
      title: 'Test Tx',
      amount: 100n,
      date: new Date(Date.now() - 86400000),
      type: 'EXPENSE',
      status: TransactionStatus.COMPLETED,
      ...props,
    },
    id,
  );
  if (r.isLeft()) throw r.value;
  return r.value;
}

export function makeTransactionWithStatus(
  status: TransactionStatus,
  overrides: Partial<Parameters<typeof Transaction.create>[0]> & {
    id?: string;
  } = {},
): Transaction {
  return makeTransaction({
    date:
      status === TransactionStatus.PENDING
        ? new Date(Date.now() + 86400000)
        : new Date(Date.now() - 86400000),
    status,
    ...overrides,
  });
}

export function makeCompletedCharge(
  amount: bigint,
  overrides: Partial<Parameters<typeof Transaction.create>[0]> & {
    id?: string;
  } = {},
): Transaction {
  return makeTransaction({
    accountId: 'acc-1',
    title: 'Compra no cartão',
    amount,
    date: new Date('2024-01-20'),
    type: 'EXPENSE',
    status: TransactionStatus.COMPLETED,
    ...overrides,
  });
}

export function makeCompletedPayment(
  amount: bigint,
  overrides: Partial<Parameters<typeof Transaction.create>[0]> & {
    id?: string;
  } = {},
): Transaction {
  return makeTransaction({
    accountId: 'acc-2',
    destinationAccountId: 'acc-1',
    title: 'Pagamento de Fatura',
    amount,
    date: new Date('2024-01-25'),
    type: 'TRANSFER',
    status: TransactionStatus.COMPLETED,
    ...overrides,
  });
}
