import { TransactionStatus, TransactionType } from '@constants/enums';
import { Transaction } from './Transaction';

describe('Transaction entity', () => {
  const pastDate = new Date('2020-01-01');
  const futureDate = new Date('2099-01-01');

  function makeProps(
    overrides: Partial<Parameters<typeof Transaction.create>[0]> = {},
  ) {
    return {
      workspaceId: 'workspace-1',
      accountId: 'account-1',
      categoryId: 'category-1',
      title: 'Grocery shopping',
      amount: 5000n,
      date: pastDate,
      type: TransactionType.EXPENSE as keyof typeof TransactionType,
      status: TransactionStatus.COMPLETED,
      ...overrides,
    };
  }

  describe('create()', () => {
    it('should create a valid transaction', () => {
      expect(Transaction.create(makeProps()).isRight()).toBe(true);
    });

    it('should reject amount <= 0', () => {
      expect(Transaction.create(makeProps({ amount: 0n })).isLeft()).toBe(true);
      expect(Transaction.create(makeProps({ amount: -100n })).isLeft()).toBe(
        true,
      );
    });

    it('should reject empty title', () => {
      expect(Transaction.create(makeProps({ title: '' })).isLeft()).toBe(true);
      expect(Transaction.create(makeProps({ title: '   ' })).isLeft()).toBe(
        true,
      );
    });

    it('should reject a transaction without categoryId', () => {
      expect(Transaction.create(makeProps({ categoryId: '' })).isLeft()).toBe(
        true,
      );
    });

    it('should reject TRANSFER without destinationAccountId', () => {
      const result = Transaction.create(
        makeProps({
          type: TransactionType.TRANSFER as keyof typeof TransactionType,
          destinationAccountId: null,
        }),
      );
      expect(result.isLeft()).toBe(true);
    });

    it('should reject TRANSFER where destination equals origin', () => {
      const result = Transaction.create(
        makeProps({
          type: TransactionType.TRANSFER as keyof typeof TransactionType,
          accountId: 'account-1',
          destinationAccountId: 'account-1',
        }),
      );
      expect(result.isLeft()).toBe(true);
    });

    it('should create a valid TRANSFER with different accounts', () => {
      const result = Transaction.create(
        makeProps({
          type: TransactionType.TRANSFER as keyof typeof TransactionType,
          destinationAccountId: 'account-2',
        }),
      );
      expect(result.isRight()).toBe(true);
    });
  });

  describe('updateDetails()', () => {
    function makeTx() {
      const result = Transaction.create(makeProps());
      if (result.isLeft()) throw result.value;
      return result.value;
    }

    it('should update title and description', () => {
      const tx = makeTx();
      tx.updateDetails('New title', 'Some description');
      expect(tx.title).toBe('New title');
      expect(tx.description).toBe('Some description');
    });

    it('should reject empty title', () => {
      const tx = makeTx();
      expect(tx.updateDetails('', null).isLeft()).toBe(true);
    });
  });

  describe('complete() / markAsPending()', () => {
    it('should mark a pending transaction as completed', () => {
      const result = Transaction.create(
        makeProps({
          date: futureDate,
          status: TransactionStatus.PENDING,
        }),
      );
      if (result.isLeft()) throw result.value;
      const tx = result.value;
      expect(tx.complete().isRight()).toBe(true);
      expect(tx.status).toBe(TransactionStatus.COMPLETED);
    });

    it('should reject completing an already completed transaction', () => {
      const result = Transaction.create(
        makeProps({ date: pastDate, status: TransactionStatus.COMPLETED }),
      );
      if (result.isLeft()) throw result.value;
      expect(result.value.complete().isLeft()).toBe(true);
    });

    it('should mark a completed transaction as pending', () => {
      const result = Transaction.create(
        makeProps({ status: TransactionStatus.COMPLETED }),
      );
      if (result.isLeft()) throw result.value;
      const tx = result.value;
      expect(tx.markAsPending().isRight()).toBe(true);
      expect(tx.status).toBe(TransactionStatus.PENDING);
    });
  });
});
