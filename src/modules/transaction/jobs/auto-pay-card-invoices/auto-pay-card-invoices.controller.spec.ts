import { env } from '@infra/env';
import {
  InternalServerErrorException,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { AutoPayCardInvoicesJobController } from './auto-pay-card-invoices.controller';
import type {
  AutoPayCardInvoicesJobService,
  AutopaySummary,
} from './auto-pay-card-invoices.service';

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

function summaryOf(overrides: Partial<AutopaySummary>): AutopaySummary {
  return {
    outcome: 'success',
    settledCount: 0,
    failedCount: 0,
    skipped: {
      'already-paid': 0,
      'already-settled': 0,
      'settled-by-another-run': 0,
      'nothing-to-pay': 0,
      'insufficient-balance': 0,
    },
    processedCount: 0,
    remainingCount: 0,
    ...overrides,
  };
}

describe('AutoPayCardInvoicesJobController', () => {
  let service: jest.Mocked<AutoPayCardInvoicesJobService>;
  let controller: AutoPayCardInvoicesJobController;

  beforeEach(() => {
    env.CRON_API_KEY = CRON_KEY;
    service = {
      execute: jest.fn(),
    } as unknown as jest.Mocked<AutoPayCardInvoicesJobService>;
    controller = new AutoPayCardInvoicesJobController(service);
  });

  afterEach(() => jest.clearAllMocks());

  it('should reject a wrong api key', async () => {
    await expect(controller.handle('wrong')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(service.execute).not.toHaveBeenCalled();
  });

  it('should log success at info and return the summary', async () => {
    const summary = summaryOf({ settledCount: 2, processedCount: 2 });
    service.execute.mockResolvedValue(summary);

    await expect(controller.handle(CRON_KEY)).resolves.toBe(summary);
    expect(loggerLog).toHaveBeenCalledTimes(1);
  });

  it('should log partial failure at warn', async () => {
    service.execute.mockResolvedValue(
      summaryOf({
        outcome: 'partial-failure',
        settledCount: 1,
        failedCount: 1,
        processedCount: 2,
      }),
    );

    await controller.handle(CRON_KEY);

    expect(loggerWarn).toHaveBeenCalledTimes(1);
  });

  it('should log total failure at error and answer with a server error', async () => {
    service.execute.mockResolvedValue(
      summaryOf({
        outcome: 'total-failure',
        failedCount: 2,
        processedCount: 2,
      }),
    );

    await expect(controller.handle(CRON_KEY)).rejects.toBeInstanceOf(
      InternalServerErrorException,
    );
    expect(loggerError).toHaveBeenCalledTimes(1);
  });

  it('should answer 200 on partial failure', async () => {
    const summary = summaryOf({
      outcome: 'partial-failure',
      settledCount: 1,
      failedCount: 1,
      processedCount: 2,
    });
    service.execute.mockResolvedValue(summary);

    await expect(controller.handle(CRON_KEY)).resolves.toBe(summary);
  });
});
