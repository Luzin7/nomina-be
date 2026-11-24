import { DrizzleService } from '@infra/databases/drizzle/drizzle.service';
import { AccountType, RecurrenceFrequency } from '@constants/enums';
import { SpendableRepositoryImplementation } from './spendable.repository';

const CURRENT_TIMEOUT_STATEMENT = 'current_setting';
const SET_TIMEOUT_STATEMENT = 'SET LOCAL statement_timeout = 1000';
const RESTORE_TIMEOUT_STATEMENT = 'set_config';

function makeSequencedRepository(results: unknown[]) {
  let next = 0;
  const consume = (): unknown => {
    const result = results[Math.min(next, results.length - 1)];
    next += 1;
    return result;
  };
  const execute = jest.fn().mockResolvedValue([{ statementTimeout: '5s' }]);
  const builder = {
    select: jest.fn(),
    from: jest.fn(),
    innerJoin: jest.fn(),
    where: jest.fn(),
    groupBy: jest.fn(),
    orderBy: jest.fn(),
    limit: jest.fn(async () => consume()),
    then: (resolve: (value: unknown) => unknown) => resolve(consume()),
  };
  builder.select.mockReturnValue(builder);
  builder.from.mockReturnValue(builder);
  builder.innerJoin.mockReturnValue(builder);
  builder.where.mockReturnValue(builder);
  builder.groupBy.mockReturnValue(builder);
  builder.orderBy.mockReturnValue(builder);

  const transaction = jest.fn(
    async (callback: (tx: unknown) => Promise<unknown>) =>
      callback({ ...builder, execute }),
  );
  const drizzle = new DrizzleService({ transaction } as never);

  return {
    repository: new SpendableRepositoryImplementation(drizzle),
    execute,
    transaction,
  };
}

function makeRepository(result: unknown) {
  return makeSequencedRepository([result]);
}

const statementsOf = (execute: jest.Mock): string[] =>
  execute.mock.calls.map(([statement]) => JSON.stringify(statement));

const expectBoundedRead = (execute: jest.Mock): void => {
  expect(statementsOf(execute)).toEqual([
    expect.stringContaining(CURRENT_TIMEOUT_STATEMENT),
    expect.stringContaining(SET_TIMEOUT_STATEMENT),
    expect.stringContaining(RESTORE_TIMEOUT_STATEMENT),
  ]);
  expect(statementsOf(execute)[2]).toContain('5s');
};

const RECURRENCE_ROW = {
  id: 'rule-1',
  type: 'EXPENSE',
  accountType: AccountType.CHECKING,
  amount: 50000,
  frequency: RecurrenceFrequency.MONTHLY,
  interval: 1,
  startDateEpochMs: '1762300800000',
  endDateEpochMs: null,
  lastGeneratedEpochMs: null,
  materializedDates: [1762400800000],
};

const CASH_FLOW = {
  workspaceId: 'ws-1',
  startDate: '2026-11-01',
  endDate: '2026-11-30',
  timezone: 'America/Sao_Paulo',
};

describe('SpendableRepositoryImplementation read timeouts', () => {
  it('bounds findCycle to one second', async () => {
    const { repository, execute, transaction } = makeRepository([
      { cycle: 'monthly' },
    ]);

    const cycle = await repository.findCycle('ws-1');

    expect(cycle).toBe('monthly');
    expect(transaction).toHaveBeenCalledTimes(1);
    expectBoundedRead(execute);
  });

  it('subtracts only the undebited remainder of pending cash expenses', async () => {
    const { repository, execute } = makeSequencedRepository([
      [
        { id: 'tx-1', accountId: 'acc-1', amount: 20000 },
        { id: 'tx-2', accountId: 'acc-1', amount: 30000 },
        { id: 'tx-3', accountId: 'acc-2', amount: 5000 },
      ],
      [
        { transactionId: 'tx-1', accountId: 'acc-1', debitedCents: -20000 },
        { transactionId: 'tx-2', accountId: 'acc-1', debitedCents: -12000 },
      ],
    ]);

    const total = await repository.sumPendingCashExpenses(CASH_FLOW);

    expect(total).toBe(23000);
    expectBoundedRead(execute);
  });

  it('skips the movement read when there is no pending cash expense', async () => {
    const { repository, execute } = makeSequencedRepository([[]]);

    const total = await repository.sumPendingCashExpenses(CASH_FLOW);

    expect(total).toBe(0);
    expectBoundedRead(execute);
  });

  it('bounds the completed cash income sum to one second', async () => {
    const { repository, execute } = makeRepository([{ total: 900 }]);

    const total = await repository.sumCompletedCashIncome(CASH_FLOW);

    expect(total).toBe(900);
    expectBoundedRead(execute);
  });

  it('bounds the cash balance list to one second', async () => {
    const { repository, execute } = makeRepository([
      { accountId: 'acc-1', balanceCents: 200000 },
    ]);

    const balances = await repository.listCashBalances('ws-1');

    expect(balances).toEqual([{ accountId: 'acc-1', balanceCents: 200000 }]);
    expectBoundedRead(execute);
  });

  it('bounds the recurrence list to one second', async () => {
    const { repository, execute } = makeRepository([RECURRENCE_ROW]);

    const recurrences = await repository.listActiveRecurrences('ws-1');

    expect(recurrences).toHaveLength(1);
    expect(recurrences[0].materializedDates).toEqual([new Date(1762400800000)]);
    expectBoundedRead(execute);
  });
});
