import { env } from '@infra/env';
import {
  InternalServerErrorException,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { DetectRecurringSuggestionsJobController } from './detect-recurring-suggestions.controller';
import type {
  DetectRecurringSuggestionsJobService,
  RecurringSuggestionDetectionJobSummary,
} from './detect-recurring-suggestions.service';

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
  overrides: Partial<RecurringSuggestionDetectionJobSummary> = {},
): RecurringSuggestionDetectionJobSummary {
  return {
    outcome: 'success',
    scanned: 0,
    persisted: 0,
    unchanged: 0,
    notDue: 0,
    failed: 0,
    failedWorkspaceIds: [],
    truncated: false,
    lastCursor: null,
    skipped: false,
    ...overrides,
  };
}

describe('DetectRecurringSuggestionsJobController', () => {
  let service: jest.Mocked<DetectRecurringSuggestionsJobService>;
  let controller: DetectRecurringSuggestionsJobController;

  beforeEach(() => {
    env.CRON_API_KEY = CRON_KEY;
    service = {
      execute: jest.fn(),
    } as unknown as jest.Mocked<DetectRecurringSuggestionsJobService>;
    controller = new DetectRecurringSuggestionsJobController(service);
  });

  afterEach(() => jest.clearAllMocks());

  it('rejects a wrong api key', async () => {
    await expect(controller.handle('wrong')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(service.execute).not.toHaveBeenCalled();
  });

  it('returns the summary and logs success at info', async () => {
    const summary = summaryOf({
      scanned: 2,
      persisted: 1,
      notDue: 1,
      lastCursor: 'ws-2',
    });
    service.execute.mockResolvedValue(summary);

    await expect(controller.handle(CRON_KEY)).resolves.toBe(summary);
    expect(loggerLog).toHaveBeenCalledTimes(1);
  });

  it('answers a partial failure with a server error naming the failed workspaces', async () => {
    service.execute.mockResolvedValue(
      summaryOf({
        outcome: 'partial-failure',
        scanned: 2,
        persisted: 1,
        failed: 1,
        failedWorkspaceIds: ['ws-2'],
      }),
    );

    await expect(controller.handle(CRON_KEY)).rejects.toMatchObject({
      response: {
        scanned: 2,
        persisted: 1,
        unchanged: 0,
        notDue: 0,
        failed: 1,
        failedWorkspaceIds: ['ws-2'],
        truncated: false,
      },
    });
    expect(loggerWarn).toHaveBeenCalledTimes(1);
  });

  it('answers an empty run with zero counts and no error', async () => {
    const summary = summaryOf({ outcome: 'nothing-due' });
    service.execute.mockResolvedValue(summary);

    await expect(controller.handle(CRON_KEY)).resolves.toEqual(summary);
    expect(loggerError).not.toHaveBeenCalled();
  });

  it('answers with a server error when every scanned workspace failed', async () => {
    service.execute.mockResolvedValue(
      summaryOf({
        outcome: 'total-failure',
        scanned: 2,
        failed: 2,
        failedWorkspaceIds: ['ws-1', 'ws-2'],
      }),
    );

    const handle = controller.handle(CRON_KEY);
    await expect(handle).rejects.toBeInstanceOf(InternalServerErrorException);
    await expect(handle).rejects.toMatchObject({
      response: {
        scanned: 2,
        persisted: 0,
        unchanged: 0,
        notDue: 0,
        failed: 2,
        failedWorkspaceIds: ['ws-1', 'ws-2'],
        truncated: false,
      },
    });
    expect(loggerError).toHaveBeenCalledTimes(1);
  });

  it('answers a truncated run with a server error keeping truncated true', async () => {
    service.execute.mockResolvedValue(
      summaryOf({
        outcome: 'success',
        scanned: 1,
        persisted: 1,
        truncated: true,
        lastCursor: 'ws-1',
      }),
    );

    await expect(controller.handle(CRON_KEY)).rejects.toMatchObject({
      response: {
        scanned: 1,
        persisted: 1,
        unchanged: 0,
        notDue: 0,
        failed: 0,
        failedWorkspaceIds: [],
        truncated: true,
      },
    });
  });

  it('answers a lock-busy run with the skipped summary', async () => {
    const summary = summaryOf({ skipped: true });
    service.execute.mockResolvedValue(summary);

    await expect(controller.handle(CRON_KEY)).resolves.toBe(summary);
    expect(loggerError).not.toHaveBeenCalled();
  });
});
