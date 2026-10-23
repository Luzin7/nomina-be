import { BalanceMovementCause } from '@constants/enums';
import { DrizzleService } from '@infra/databases/drizzle/drizzle.service';
import { TransactionRepositoryImplementation } from './transaction.repository';

type MovementRow = {
  workspaceId: string;
  accountId: string;
  transactionId: string | null;
  cause: BalanceMovementCause;
  delta: number;
  balanceAfter: number;
  actorId: string;
};

type MovementWriter = {
  writeBalanceDeltas(
    tx: unknown,
    deltas: Map<string, bigint>,
    movement: {
      transactionId: string | null;
      cause: BalanceMovementCause;
      actorId: string;
    },
  ): Promise<void>;
};

function makeTx(balanceAfter = 900n) {
  const inserted: MovementRow[] = [];
  const tx = {
    update: jest.fn().mockReturnValue({
      set: jest.fn().mockReturnValue({
        where: jest.fn().mockReturnValue({
          returning: jest
            .fn()
            .mockResolvedValue([
              { balance: balanceAfter, workspaceId: 'ws-1' },
            ]),
        }),
      }),
    }),
    insert: jest.fn().mockReturnValue({
      values: jest.fn().mockImplementation((row: MovementRow) => {
        inserted.push(row);
        return Promise.resolve();
      }),
    }),
  };

  return { tx, inserted };
}

function makeRepository() {
  return new TransactionRepositoryImplementation({
    db: {},
  } as unknown as DrizzleService);
}

describe('balance movement actor', () => {
  const cases = [
    BalanceMovementCause.TRANSACTION_CREATED,
    BalanceMovementCause.TRANSACTION_UPDATED,
    BalanceMovementCause.TRANSACTION_DELETED,
    BalanceMovementCause.STATUS_CHANGED,
    BalanceMovementCause.INVOICE_PAID,
    BalanceMovementCause.OPENING,
  ];

  it.each(cases)('persists a non-null %s actor', async (cause) => {
    const actorId = 'actor-'.concat(cause.toLowerCase());
    const repository = makeRepository() as unknown as MovementWriter;
    const { tx, inserted } = makeTx();

    await repository.writeBalanceDeltas(tx, new Map([['acc-1', -100n]]), {
      transactionId: 'tx-1',
      cause,
      actorId,
    });

    expect(inserted).toHaveLength(1);
    expect(inserted[0].actorId).toBe(actorId);
    expect(inserted[0].actorId).not.toBeNull();
    expect(inserted[0].cause).toBe(cause);
  });

  it('accepts a system actor for job-driven writes', async () => {
    const repository = makeRepository() as unknown as MovementWriter;
    const { tx, inserted } = makeTx();

    await repository.writeBalanceDeltas(tx, new Map([['acc-1', 100n]]), {
      transactionId: null,
      cause: BalanceMovementCause.INVOICE_PAID,
      actorId: 'system:pay-credit-card-invoice',
    });

    expect(inserted[0].actorId).toBe('system:pay-credit-card-invoice');
  });
});
