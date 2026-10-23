import { env } from '@infra/env';
import {
  InternalServerErrorException,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { SettleCardInstallmentsJobController } from './settle-card-installments.controller';
import type {
  SettleCardInstallmentsJobService,
  SettleCardInstallmentsSummary,
} from './settle-card-installments.service';

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
  overrides: Partial<SettleCardInstallmentsSummary>,
): SettleCardInstallmentsSummary {
  return {
    outcome: 'success',
    settledCount: 0,
    skippedCount: 0,
    failedCount: 0,
    processedCount: 0,
    remainingCount: 0,
    ...overrides,
  };
}

describe('SettleCardInstallmentsJobController', () => {
  let service: jest.Mocked<SettleCardInstallmentsJobService>;
  let controller: SettleCardInstallmentsJobController;

  beforeEach(() => {
    env.CRON_API_KEY = CRON_KEY;
    service = {
      execute: jest.fn(),
    } as unknown as jest.Mocked<SettleCardInstallmentsJobService>;
    controller = new SettleCardInstallmentsJobController(service);
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
