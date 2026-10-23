import { DrizzleService } from '@infra/databases/drizzle/drizzle.service';
import {
  BalanceLedgerUncoveredError,
  BalanceReconciliationDivergenceError,
} from '@modules/transaction/errors';
import { Logger } from '@nestjs/common';
import { captureException } from '@sentry/nestjs';
import {
  AccountReconciliationRow,
  ReconcileBalancesJobService,
} from './reconcile-balances.service';

jest.mock('@sentry/nestjs', () => ({ captureException: jest.fn() }));

const mockCaptureException = captureException as jest.MockedFunction<
  typeof captureException
>;

jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);

function makeRow(
  overrides: Partial<AccountReconciliationRow> = {},
): AccountReconciliationRow {
  return {
    account_id: 'acc-1',
    account_name: 'Checking',
    workspace_id: 'ws-1',
    balance: 50000,
    movements: 50000,
    has_opening: true,
    ...overrides,
  };
}

describe('ReconcileBalancesJobService', () => {
  let service: ReconcileBalancesJobService;
  const executeQuery = jest.fn();
  const runTransaction = jest.fn(
    async (run: (tx: { execute: typeof executeQuery }) => Promise<unknown>) =>
      run({ execute: executeQuery }),
  );

  beforeEach(() => {
    executeQuery.mockResolvedValue([]);
    const database = {
      db: { transaction: runTransaction },
    } as unknown as DrizzleService;

    service = new ReconcileBalancesJobService(database);
  });

  afterEach(() => jest.clearAllMocks());

  it('reports no divergence when every account matches the ledger', async () => {
    executeQuery.mockResolvedValue([
      makeRow(),
      makeRow({
        account_id: 'acc-2',
        account_name: 'Savings',
        balance: 0,
        movements: 0,
      }),
    ]);

    const result = await service.execute();

    expect(result).toEqual({
      accountsChecked: 2,
      uncovered: 0,
      divergences: [],
    });
    expect(mockCaptureException).not.toHaveBeenCalled();
  });

  it('reports an uncovered account and a divergence as two distinct events', async () => {
    executeQuery.mockResolvedValue([
      makeRow({ account_id: 'acc-2', balance: 50700, movements: 50000 }),
      makeRow({ account_id: 'acc-3', has_opening: false, movements: 0 }),
    ]);

    const result = await service.execute();

    expect(result.uncovered).toBe(1);
    expect(result.accountsChecked).toBe(2);
    expect(result.divergences).toEqual([
      {
        accountId: 'acc-2',
        accountName: 'Checking',
        workspaceId: 'ws-1',
        balance: 50700,
        movements: 50000,
        unexplained: 700,
      },
    ]);
    expect(mockCaptureException).toHaveBeenCalledTimes(2);

    const [divergenceError, divergenceContext] =
      mockCaptureException.mock.calls[0];
    expect(divergenceError).toBeInstanceOf(
      BalanceReconciliationDivergenceError,
    );
    expect(divergenceContext).toEqual({
      extra: { divergences: result.divergences },
    });

    const [uncoveredError, uncoveredContext] =
      mockCaptureException.mock.calls[1];
    expect(uncoveredError).toBeInstanceOf(BalanceLedgerUncoveredError);
    expect(uncoveredContext).toEqual({
      extra: { uncovered: 1, accountIds: ['acc-3'] },
    });
  });

  it('reports uncovered accounts as a single event and no divergences', async () => {
    executeQuery.mockResolvedValue([
      makeRow({ account_id: 'acc-1', has_opening: false, movements: 0 }),
      makeRow({ account_id: 'acc-2', has_opening: false, movements: 0 }),
    ]);

    const result = await service.execute();

    expect(result).toEqual({
      accountsChecked: 2,
      uncovered: 2,
      divergences: [],
    });
    expect(mockCaptureException).toHaveBeenCalledTimes(1);

    const [error, context] = mockCaptureException.mock.calls[0];
    expect(error).toBeInstanceOf(BalanceLedgerUncoveredError);
    expect((error as BalanceLedgerUncoveredError).message).toBe(
      'Contas sem movimentação de abertura não podem ser conciliadas.',
    );
    expect(context).toEqual({
      extra: { uncovered: 2, accountIds: ['acc-1', 'acc-2'] },
    });
  });

  it('caps the uncovered account ids sent to Sentry', async () => {
    executeQuery.mockResolvedValue(
      Array.from({ length: 25 }, (_, index) =>
        makeRow({
          account_id: `acc-${index}`,
          has_opening: false,
          movements: 0,
        }),
      ),
    );

    await service.execute();

    const [, context] = mockCaptureException.mock.calls[0];
    expect(context).toEqual({
      extra: {
        uncovered: 25,
        accountIds: Array.from({ length: 20 }, (_, index) => `acc-${index}`),
      },
    });
  });

  it('reads the ledger in a read-only transaction bounded by a statement timeout', async () => {
    executeQuery.mockResolvedValue([makeRow()]);

    await service.execute();

    expect(runTransaction).toHaveBeenCalledWith(expect.any(Function), {
      accessMode: 'read only',
    });
    expect(executeQuery).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(executeQuery.mock.calls[0][0])).toContain(
      "set local statement_timeout = '30s'",
    );
  });

  it('orders divergences by the worst unexplained balance first', async () => {
    executeQuery.mockResolvedValue([
      makeRow({ account_id: 'acc-small', balance: 50100 }),
      makeRow({ account_id: 'acc-worst', balance: 40000 }),
      makeRow({ account_id: 'acc-mid', balance: 49500 }),
    ]);

    const result = await service.execute();

    expect(result.divergences.map((item) => item.accountId)).toEqual([
      'acc-worst',
      'acc-mid',
      'acc-small',
    ]);
  });

  it('propagates a database failure instead of returning an empty summary', async () => {
    executeQuery.mockRejectedValue(new Error('db down'));

    await expect(service.execute()).rejects.toThrow('db down');
    expect(mockCaptureException).not.toHaveBeenCalled();
  });
});
