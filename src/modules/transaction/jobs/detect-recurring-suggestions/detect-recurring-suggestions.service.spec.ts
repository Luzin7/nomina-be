import { DetectRecurringSuggestionsService } from '@modules/transaction/features/recurring-suggestions/detect-recurring-suggestions.service';
import { RecurringSuggestionRepository } from '@modules/transaction/repositories/contracts/RecurringSuggestionRepository';
import { Logger } from '@nestjs/common';
import { DateProvider } from '@providers/date/contracts/DateProvider';
import { InMemoryCacheProvider } from '@shared/cache/test-helpers/in-memory-cache';
import { DetectRecurringSuggestionsJobService } from './detect-recurring-suggestions.service';

const NOW = new Date('2026-11-09T12:00:00.000Z');

describe('DetectRecurringSuggestionsJobService', () => {
  let service: DetectRecurringSuggestionsJobService;
  let repository: jest.Mocked<RecurringSuggestionRepository>;
  let detection: jest.Mocked<DetectRecurringSuggestionsService>;
  let dateProvider: jest.Mocked<DateProvider>;
  let cache: InMemoryCacheProvider;

  beforeEach(() => {
    repository = {
      findDueWorkspaceBatch: jest.fn().mockResolvedValue([]),
    } as unknown as jest.Mocked<RecurringSuggestionRepository>;
    detection = {
      execute: jest.fn().mockResolvedValue('not-due'),
    } as unknown as jest.Mocked<DetectRecurringSuggestionsService>;
    dateProvider = {
      now: jest.fn(() => NOW),
    } as unknown as jest.Mocked<DateProvider>;
    cache = new InMemoryCacheProvider();

    service = new DetectRecurringSuggestionsJobService(
      repository,
      detection,
      cache,
      dateProvider,
    );
  });

  afterEach(() => jest.clearAllMocks());

  it('tallies one persisted and one not-due workspace', async () => {
    repository.findDueWorkspaceBatch
      .mockResolvedValueOnce(['ws-1', 'ws-2'])
      .mockResolvedValueOnce([]);
    detection.execute.mockImplementation((workspaceId) =>
      Promise.resolve(workspaceId === 'ws-1' ? 'persisted' : 'not-due'),
    );

    const summary = await service.execute();

    expect(summary).toEqual({
      outcome: 'success',
      scanned: 2,
      persisted: 1,
      unchanged: 0,
      notDue: 1,
      failed: 0,
      failedWorkspaceIds: [],
      truncated: false,
      lastCursor: 'ws-2',
      skipped: false,
    });
    expect(repository.findDueWorkspaceBatch).toHaveBeenCalledWith(
      null,
      100,
      NOW,
    );
    expect(detection.execute).toHaveBeenCalledWith('ws-1', NOW);
  });

  it('tallies a gate advance with zero rows as unchanged', async () => {
    repository.findDueWorkspaceBatch
      .mockResolvedValueOnce(['ws-1'])
      .mockResolvedValueOnce([]);
    detection.execute.mockResolvedValue('unchanged');

    const summary = await service.execute();

    expect(summary.unchanged).toBe(1);
    expect(summary.persisted).toBe(0);
    expect(summary.outcome).toBe('success');
  });

  it('reports total failure when every scanned workspace failed', async () => {
    repository.findDueWorkspaceBatch
      .mockResolvedValueOnce(['ws-1', 'ws-2'])
      .mockResolvedValueOnce([]);
    detection.execute.mockResolvedValue('failed');

    const summary = await service.execute();

    expect(summary.outcome).toBe('total-failure');
    expect(summary.scanned).toBe(2);
    expect(summary.failed).toBe(2);
  });

  it('keeps a partial failure out of the total-failure outcome', async () => {
    repository.findDueWorkspaceBatch
      .mockResolvedValueOnce(['ws-1', 'ws-2'])
      .mockResolvedValueOnce([]);
    detection.execute.mockImplementation((workspaceId) =>
      Promise.resolve(workspaceId === 'ws-1' ? 'persisted' : 'failed'),
    );

    const summary = await service.execute();

    expect(summary.outcome).toBe('partial-failure');
    expect(summary.persisted).toBe(1);
    expect(summary.failed).toBe(1);
    expect(summary.failedWorkspaceIds).toEqual(['ws-2']);
  });

  it('skips the run and warns with the lock key when the lock is held', async () => {
    jest.spyOn(cache, 'acquireLock').mockResolvedValue(null);
    const warn = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);

    const summary = await service.execute();

    expect(summary.scanned).toBe(0);
    expect(summary.skipped).toBe(true);
    expect(repository.findDueWorkspaceBatch).not.toHaveBeenCalled();
    expect(warn.mock.calls.flat().join(' ')).toContain(
      'job:recurring-suggestions-detect',
    );
    warn.mockRestore();
  });

  it('reports nothing due with zero counts when no workspace was scanned', async () => {
    const summary = await service.execute();

    expect(summary).toEqual({
      outcome: 'nothing-due',
      scanned: 0,
      persisted: 0,
      unchanged: 0,
      notDue: 0,
      failed: 0,
      failedWorkspaceIds: [],
      truncated: false,
      lastCursor: null,
      skipped: false,
    });
  });

  it('tallies a returned failure instead of a silent zero', async () => {
    repository.findDueWorkspaceBatch
      .mockResolvedValueOnce(['ws-1', 'ws-2'])
      .mockResolvedValueOnce([]);
    detection.execute.mockImplementation((workspaceId) =>
      Promise.resolve(workspaceId === 'ws-1' ? 'failed' : 'not-due'),
    );

    const summary = await service.execute();

    expect(summary.outcome).toBe('partial-failure');
    expect(summary.failed).toBe(1);
    expect(summary.failedWorkspaceIds).toEqual(['ws-1']);
    expect(summary.notDue).toBe(1);
    expect(summary.persisted).toBe(0);
  });

  it('stops once the worst case of one workspace no longer fits the budget', async () => {
    repository.findDueWorkspaceBatch.mockResolvedValueOnce(['ws-1', 'ws-2']);
    dateProvider.now
      .mockReturnValueOnce(NOW)
      .mockReturnValueOnce(NOW)
      .mockReturnValue(new Date(NOW.getTime() + 30_000));

    const summary = await service.execute();

    expect(summary.truncated).toBe(true);
    expect(summary.scanned).toBe(1);
    expect(summary.lastCursor).toBe('ws-1');
    expect(detection.execute).toHaveBeenCalledTimes(1);
  });

  it('skips a workspace when the remaining budget is under its worst case', async () => {
    repository.findDueWorkspaceBatch.mockResolvedValueOnce(['ws-1']);
    dateProvider.now
      .mockReturnValueOnce(NOW)
      .mockReturnValue(new Date(NOW.getTime() + 6_000));

    const summary = await service.execute();

    expect(summary.truncated).toBe(true);
    expect(summary.scanned).toBe(0);
    expect(summary.lastCursor).toBeNull();
    expect(detection.execute).not.toHaveBeenCalled();
    expect(repository.findDueWorkspaceBatch).toHaveBeenCalledTimes(1);
  });
});
