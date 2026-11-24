import { DrizzleService } from '@infra/databases/drizzle/drizzle.service';
import { AccountType, RecurrenceFrequency } from '@constants/enums';
import { SpendableRepositoryImplementation } from './spendable.repository';

const CURRENT_TIMEOUT_STATEMENT = 'current_setting';
const SET_TIMEOUT_STATEMENT = 'SET LOCAL statement_timeout = 1000';
const RESTORE_TIMEOUT_STATEMENT = 'set_config';

function makeRepository(result: unknown) {
  const execute = jest.fn().mockResolvedValue([{ statementTimeout: '5s' }]);
  const builder = {
    select: jest.fn(),
    from: jest.fn(),
    innerJoin: jest.fn(),
    where: jest.fn(),
    limit: jest.fn().mockResolvedValue(result),
    then: (resolve: (value: unknown) => unknown) => resolve(result),
  };
  builder.select.mockReturnValue(builder);
  builder.from.mockReturnValue(builder);
  builder.innerJoin.mockReturnValue(builder);
  builder.where.mockReturnValue(builder);

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

  it('bounds the pending cash expense sum to one second', async () => {
    const { repository, execute } = makeRepository([{ total: 700 }]);

    const total = await repository.sumPendingCashExpenses(CASH_FLOW);

    expect(total).toBe(700);
    expectBoundedRead(execute);
  });

  it('bounds the completed cash income sum to one second', async () => {
    const { repository, execute } = makeRepository([{ total: 900 }]);

    const total = await repository.sumCompletedCashIncome(CASH_FLOW);

    expect(total).toBe(900);
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
