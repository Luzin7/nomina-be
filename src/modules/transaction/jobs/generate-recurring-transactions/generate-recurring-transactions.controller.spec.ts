import { env } from '@infra/env';
import { Logger } from '@nestjs/common';
import { right } from '@shared/core/errors/Either';
import { GenerateRecurringTransactionsJobController } from './generate-recurring-transactions.controller';
import type {
  GenerateRecurringTransactionsJobService,
  GenerateRecurringTransactionsSummary,
} from './generate-recurring-transactions.service';

const CRON_KEY = 'cron-key';

const loggerLog = jest
  .spyOn(Logger.prototype, 'log')
  .mockImplementation(() => undefined);
const loggerWarn = jest
  .spyOn(Logger.prototype, 'warn')
  .mockImplementation(() => undefined);
const loggerError = jest
  .spyOn(Logger.prototype, 'error')
  .mockImplementation(() => undefined);

function summaryOf(
  overrides: Partial<GenerateRecurringTransactionsSummary>,
): GenerateRecurringTransactionsSummary {
  return {
    outcome: 'success',
    generatedCount: 0,
    failedCount: 0,
    processedCount: 0,
    ...overrides,
  };
}

describe('GenerateRecurringTransactionsJobController', () => {
  let service: jest.Mocked<GenerateRecurringTransactionsJobService>;
  let controller: GenerateRecurringTransactionsJobController;

  beforeEach(() => {
    env.CRON_API_KEY = CRON_KEY;
    service = {
      execute: jest.fn(),
    } as unknown as jest.Mocked<GenerateRecurringTransactionsJobService>;
    controller = new GenerateRecurringTransactionsJobController(service);
  });

  afterEach(() => jest.clearAllMocks());

  async function log(summary: GenerateRecurringTransactionsSummary) {
    service.execute.mockResolvedValue(right(summary));

    await controller.handle(CRON_KEY);
  }

  it('logs nothing due at info when the range is empty', async () => {
    await log(
      summaryOf({
        outcome: 'nothing-due',
        generatedCount: 0,
        failedCount: 0,
        processedCount: 0,
      }),
    );

    expect(loggerLog).toHaveBeenCalledWith(
      expect.stringMatching(/no recurring transactions were due/i),
    );
    expect(loggerWarn).not.toHaveBeenCalled();
    expect(loggerError).not.toHaveBeenCalled();
  });

  it('logs a clean run at info with its counters', async () => {
    await log(
      summaryOf({
        outcome: 'success',
        generatedCount: 2,
        failedCount: 0,
        processedCount: 2,
      }),
    );

    expect(loggerLog).toHaveBeenCalledWith(
      expect.stringMatching(/generated 2 transactions from 2 .*no failures/i),
    );
    expect(loggerWarn).not.toHaveBeenCalled();
    expect(loggerError).not.toHaveBeenCalled();
  });

  it('logs partial failure at warn with generated and failed counters', async () => {
    await log(
      summaryOf({
        outcome: 'partial-failure',
        generatedCount: 4,
        failedCount: 1,
        processedCount: 5,
      }),
    );

    expect(loggerWarn).toHaveBeenCalledWith(
      expect.stringMatching(/generated 4 transactions from 5 .*1 of 5 failed/i),
    );
    expect(loggerLog).not.toHaveBeenCalled();
    expect(loggerError).not.toHaveBeenCalled();
  });

  it('logs total failure at error, never as a successful run', async () => {
    await log(
      summaryOf({
        outcome: 'total-failure',
        generatedCount: 0,
        failedCount: 3,
        processedCount: 3,
      }),
    );

    expect(loggerError).toHaveBeenCalledWith(
      expect.stringMatching(/all 3 failed/i),
    );
    expect(loggerLog).not.toHaveBeenCalled();
    expect(loggerWarn).not.toHaveBeenCalled();
  });

  it('names the skip reason instead of reporting an empty range', async () => {
    await log(
      summaryOf({
        outcome: 'skipped-already-processed',
        generatedCount: 0,
        failedCount: 0,
        processedCount: 0,
      }),
    );

    expect(loggerLog).toHaveBeenCalledWith(
      expect.stringMatching(/skipped: the day is already marked as processed/i),
    );
    expect(loggerLog).not.toHaveBeenCalledWith(
      expect.stringMatching(/no recurring transactions were due/i),
    );
    expect(loggerError).not.toHaveBeenCalled();
  });
});
