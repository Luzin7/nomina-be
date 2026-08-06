import { RecurrenceFrequency } from '@constants/enums';
import { RecurringTransaction } from './RecurringTransaction';

describe('RecurringTransaction entity', () => {
  const START_DATE = new Date('2024-01-01');
  const END_DATE = new Date('2024-12-31');

  function makeProps(
    overrides: Partial<Parameters<typeof RecurringTransaction.create>[0]> = {},
  ) {
    return {
      workspaceId: 'ws-1',
      accountId: 'acc-1',
      categoryId: 'cat-1',
      title: 'Aluguel',
      amount: 150000n,
      frequency: RecurrenceFrequency.MONTHLY,
      startDate: START_DATE,
      type: 'EXPENSE' as const,
      ...overrides,
    };
  }

  function makeTx(overrides = {}) {
    const result = RecurringTransaction.create(makeProps(overrides));
    if (result.isLeft()) throw result.value;
    return result.value;
  }

  describe('create()', () => {
    it('should create a valid recurring transaction', () => {
      expect(RecurringTransaction.create(makeProps()).isRight()).toBe(true);
    });

    it('should default interval to 1, active to true, endDate and lastGenerated to null', () => {
      const tx = makeTx();
      expect(tx.interval).toBe(1);
      expect(tx.active).toBe(true);
      expect(tx.endDate).toBeNull();
      expect(tx.lastGenerated).toBeNull();
    });

    it('should reject zero amount', () => {
      expect(
        RecurringTransaction.create(makeProps({ amount: 0n })).isLeft(),
      ).toBe(true);
    });

    it('should reject negative amount', () => {
      expect(
        RecurringTransaction.create(makeProps({ amount: -1n })).isLeft(),
      ).toBe(true);
    });

    it('should reject interval <= 0', () => {
      expect(
        RecurringTransaction.create(makeProps({ interval: 0 })).isLeft(),
      ).toBe(true);
    });

    it('should reject a recurring transaction without categoryId', () => {
      expect(
        RecurringTransaction.create(makeProps({ categoryId: '' })).isLeft(),
      ).toBe(true);
    });

    it('should reject endDate before startDate', () => {
      const result = RecurringTransaction.create(
        makeProps({ startDate: END_DATE, endDate: START_DATE }),
      );
      expect(result.isLeft()).toBe(true);
    });

    it('should reject TRANSFER without destinationAccountId', () => {
      const result = RecurringTransaction.create(
        makeProps({ type: 'TRANSFER' }),
      );
      expect(result.isLeft()).toBe(true);
    });

    it('should reject TRANSFER where source and destination are the same', () => {
      const result = RecurringTransaction.create(
        makeProps({ type: 'TRANSFER', destinationAccountId: 'acc-1' }),
      );
      expect(result.isLeft()).toBe(true);
    });

    it('should create valid TRANSFER with distinct destination', () => {
      const result = RecurringTransaction.create(
        makeProps({ type: 'TRANSFER', destinationAccountId: 'acc-2' }),
      );
      expect(result.isRight()).toBe(true);
    });
  });

  describe('updateDetails()', () => {
    it('should update title, description and categoryId', () => {
      const tx = makeTx();
      tx.updateDetails('Novo Título', 'descrição', 'cat-1');
      expect(tx.title).toBe('Novo Título');
      expect(tx.description).toBe('descrição');
      expect(tx.categoryId).toBe('cat-1');
    });

    it('should throw when title is empty', () => {
      const tx = makeTx();
      expect(() => tx.updateDetails('', null, 'cat-1')).toThrow();
    });
  });

  describe('updateAmount()', () => {
    it('should update the amount', () => {
      const tx = makeTx();
      const result = tx.updateAmount(200000n);
      expect(result.isRight()).toBe(true);
      expect(tx.amount).toBe(200000n);
    });

    it('should reject zero amount', () => {
      expect(makeTx().updateAmount(0n).isLeft()).toBe(true);
    });
  });

  describe('updateSchedule()', () => {
    it('should update start/end date, frequency and interval', () => {
      const tx = makeTx();
      const result = tx.updateSchedule(
        START_DATE,
        END_DATE,
        RecurrenceFrequency.YEARLY,
        2,
      );
      expect(result.isRight()).toBe(true);
      expect(tx.frequency).toBe(RecurrenceFrequency.YEARLY);
      expect(tx.interval).toBe(2);
    });

    it('should reject interval <= 0', () => {
      expect(
        makeTx()
          .updateSchedule(START_DATE, null, RecurrenceFrequency.MONTHLY, 0)
          .isLeft(),
      ).toBe(true);
    });

    it('should reject endDate before startDate', () => {
      expect(
        makeTx()
          .updateSchedule(END_DATE, START_DATE, RecurrenceFrequency.MONTHLY, 1)
          .isLeft(),
      ).toBe(true);
    });
  });

  describe('convertToTransfer()', () => {
    it('should convert to TRANSFER', () => {
      const tx = makeTx();
      const result = tx.convertToTransfer('acc-2');
      expect(result.isRight()).toBe(true);
      expect(tx.type).toBe('TRANSFER');
      expect(tx.destinationAccountId).toBe('acc-2');
    });

    it('should reject empty destinationAccountId', () => {
      expect(makeTx().convertToTransfer('').isLeft()).toBe(true);
    });

    it('should reject same account as source', () => {
      expect(makeTx().convertToTransfer('acc-1').isLeft()).toBe(true);
    });
  });

  describe('convertToIncomeOrExpense()', () => {
    it('should clear destinationAccountId', () => {
      const tx = RecurringTransaction.create(
        makeProps({ type: 'TRANSFER', destinationAccountId: 'acc-2' }),
      );
      if (tx.isLeft()) throw tx.value;
      tx.value.convertToIncomeOrExpense('INCOME');
      expect(tx.value.type).toBe('INCOME');
      expect(tx.value.destinationAccountId).toBeNull();
    });
  });

  describe('deactivate() / activate()', () => {
    it('should deactivate and activate', () => {
      const tx = makeTx();
      tx.deactivate();
      expect(tx.active).toBe(false);
      tx.activate();
      expect(tx.active).toBe(true);
    });
  });

  describe('markAsGenerated()', () => {
    it('should set lastGenerated', () => {
      const tx = makeTx();
      const date = new Date('2024-02-01');
      tx.markAsGenerated(date);
      expect(tx.lastGenerated).toEqual(date);
    });
  });
});
