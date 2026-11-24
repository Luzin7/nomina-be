import { DrizzleService, DrizzleExecutor } from './drizzle.service';

const ENCLOSING_TIMEOUT = '10s';

const statementsOf = (execute: jest.Mock): string[] =>
  execute.mock.calls.map(([statement]) => JSON.stringify(statement));

const makeExecute = () =>
  jest.fn().mockResolvedValue([{ statementTimeout: ENCLOSING_TIMEOUT }]);

const makeService = () => {
  const execute = makeExecute();
  const transaction = jest.fn(
    async (work: (transaction: DrizzleExecutor) => Promise<unknown>) =>
      work({ execute } as unknown as DrizzleExecutor),
  );

  return {
    service: new DrizzleService({ transaction } as never),
    execute,
    transaction,
  };
};

describe('DrizzleService.withStatementTimeout', () => {
  it('bounds the work to one second and restores the enclosing transaction value', async () => {
    const { service, execute, transaction } = makeService();
    const work = jest.fn().mockResolvedValue('read');

    const result = await service.withStatementTimeout(work);

    expect(result).toBe('read');
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(statementsOf(execute)).toEqual([
      expect.stringContaining('current_setting'),
      expect.stringContaining('SET LOCAL statement_timeout = 1000'),
      expect.stringContaining('set_config'),
    ]);
    expect(statementsOf(execute)[2]).toContain(ENCLOSING_TIMEOUT);
    expect(statementsOf(execute)[2]).toContain('true');
  });

  it('restores the timeout inside the caller transaction instead of the outer one', async () => {
    const execute = makeExecute();
    const transaction: jest.Mock = jest.fn();
    const executor = { execute, transaction } as unknown as DrizzleExecutor;
    transaction.mockImplementation(
      (work: (transaction: DrizzleExecutor) => Promise<unknown>) =>
        work(executor),
    );
    const service = new DrizzleService({ transaction } as never);

    await service.runWithin(executor, () =>
      service.withStatementTimeout(async () => undefined),
    );

    expect(transaction).toHaveBeenCalledTimes(1);
    expect(statementsOf(execute)).toEqual([
      expect.stringContaining('current_setting'),
      expect.stringContaining('SET LOCAL statement_timeout = 1000'),
      expect.stringContaining('set_config'),
    ]);
  });

  it('propagates the failure without a restore statement after a cancelled read', async () => {
    const { service, execute } = makeService();
    const failure = new Error('canceling statement due to statement timeout');

    const attempt = service.withStatementTimeout(() => Promise.reject(failure));

    await expect(attempt).rejects.toBe(failure);
    expect(statementsOf(execute)).toEqual([
      expect.stringContaining('current_setting'),
      expect.stringContaining('SET LOCAL statement_timeout = 1000'),
    ]);
  });
});
