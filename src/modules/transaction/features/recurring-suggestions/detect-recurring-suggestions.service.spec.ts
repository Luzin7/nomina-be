import { CacheProvider } from '@infra/cache/contracts/CacheProvider';
import { RecurringSuggestionRepository } from '@modules/transaction/repositories/contracts/RecurringSuggestionRepository';
import { GetWorkspaceTimezoneService } from '@modules/workspace/services/get-workspace-timezone.service';
import { Logger } from '@nestjs/common';
import { DateProvider } from '@providers/date/contracts/DateProvider';
import { InMemoryCacheProvider } from '@shared/cache/test-helpers/in-memory-cache';
import { DetectRecurringSuggestionsService } from './detect-recurring-suggestions.service';

const LEDGER_GENERATION_KEY = 'cache-gen:report:ws-1';

const makeRepository = (): jest.Mocked<RecurringSuggestionRepository> => ({
  findDetectionState: jest.fn(),
  findDueWorkspaceBatch: jest.fn(),
  findBillCandidates: jest.fn(),
  findActiveExpenseRules: jest.fn(),
  persistDetection: jest.fn(),
  findPendingByWorkspace: jest.fn(),
  findByIdForWorkspace: jest.fn(),
  markShown: jest.fn(),
  accept: jest.fn(),
  dismiss: jest.fn(),
});

describe('DetectRecurringSuggestionsService', () => {
  let service: DetectRecurringSuggestionsService;
  let repository: jest.Mocked<RecurringSuggestionRepository>;
  let timezoneService: jest.Mocked<GetWorkspaceTimezoneService>;
  let dateProvider: jest.Mocked<DateProvider>;
  let cache: InMemoryCacheProvider;
  let errorSpy: jest.SpyInstance | undefined;

  beforeEach(() => {
    repository = makeRepository();
    timezoneService = {
      execute: jest.fn().mockResolvedValue('America/Sao_Paulo'),
    } as unknown as jest.Mocked<GetWorkspaceTimezoneService>;
    dateProvider = {
      now: jest.fn().mockReturnValue(new Date('2026-11-09T12:00:00.000Z')),
      format: jest.fn(() => '2026-11-09'),
      add: jest.fn(() => new Date('2026-08-01T03:00:00.000Z')),
      startOfMonth: jest.fn(() => new Date('2026-11-01T03:00:00.000Z')),
    } as unknown as jest.Mocked<DateProvider>;
    cache = new InMemoryCacheProvider();
    cache.counters.set(LEDGER_GENERATION_KEY, 5);

    service = new DetectRecurringSuggestionsService(
      repository,
      timezoneService,
      dateProvider,
      cache as CacheProvider,
    );
  });

  afterEach(() => {
    errorSpy?.mockRestore();
    errorSpy = undefined;
    jest.clearAllMocks();
  });

  it('skips detection when the local month was already detected', async () => {
    repository.findDetectionState.mockResolvedValue({
      lastBillDetectionAt: new Date('2026-11-05T12:00:00.000Z'),
    });

    await expect(service.execute('ws-1')).resolves.toBe('not-due');

    expect(repository.findBillCandidates).not.toHaveBeenCalled();
    expect(repository.findActiveExpenseRules).not.toHaveBeenCalled();
    expect(repository.persistDetection).not.toHaveBeenCalled();
    expect(cache.counters.get(LEDGER_GENERATION_KEY)).toBe(5);
  });

  it('bumps the ledger generation when detection persisted rows', async () => {
    repository.findDetectionState.mockResolvedValue({
      lastBillDetectionAt: new Date('2026-10-05T12:00:00.000Z'),
    });
    repository.findBillCandidates.mockResolvedValue([]);
    repository.findActiveExpenseRules.mockResolvedValue([]);
    repository.persistDetection.mockResolvedValue('persisted');

    await expect(service.execute('ws-1')).resolves.toBe('persisted');

    expect(repository.persistDetection).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: 'ws-1', patterns: [] }),
    );
    expect(cache.counters.get(LEDGER_GENERATION_KEY)).toBe(6);
  });

  it('reports unchanged when the gate advanced with zero rows', async () => {
    repository.findDetectionState.mockResolvedValue({
      lastBillDetectionAt: new Date('2026-10-05T12:00:00.000Z'),
    });
    repository.findBillCandidates.mockResolvedValue([]);
    repository.findActiveExpenseRules.mockResolvedValue([]);
    repository.persistDetection.mockResolvedValue('unchanged');

    await expect(service.execute('ws-1')).resolves.toBe('unchanged');

    expect(cache.counters.get(LEDGER_GENERATION_KEY)).toBe(5);
  });

  it('reports not-due when the gate became current at persist time', async () => {
    repository.findDetectionState.mockResolvedValue({
      lastBillDetectionAt: new Date('2026-10-05T12:00:00.000Z'),
    });
    repository.findBillCandidates.mockResolvedValue([]);
    repository.findActiveExpenseRules.mockResolvedValue([]);
    repository.persistDetection.mockResolvedValue('not-due');

    await expect(service.execute('ws-1')).resolves.toBe('not-due');

    expect(cache.counters.get(LEDGER_GENERATION_KEY)).toBe(5);
  });

  it('swallows repository failures and logs only the workspace', async () => {
    const spy = jest.spyOn(Logger.prototype, 'error').mockImplementation();
    errorSpy = spy;
    repository.findDetectionState.mockRejectedValue(
      new Error('R$ 150000 Aluguel'),
    );

    await expect(service.execute('ws-1')).resolves.toBe('failed');

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith(
      'Failed to detect recurring suggestions for workspace ws-1: Error',
    );
    expect(spy.mock.calls.flat().join(' ')).not.toMatch(/150000|Aluguel/);
    expect(cache.counters.get(LEDGER_GENERATION_KEY)).toBe(5);
  });

  it('returns failed and retries on the next call when persisting throws', async () => {
    const spy = jest.spyOn(Logger.prototype, 'error').mockImplementation();
    errorSpy = spy;
    repository.findDetectionState.mockResolvedValue({
      lastBillDetectionAt: null,
    });
    repository.findBillCandidates.mockResolvedValue([]);
    repository.findActiveExpenseRules.mockResolvedValue([]);
    repository.persistDetection
      .mockRejectedValueOnce(new Error('lock timeout'))
      .mockResolvedValueOnce('persisted');

    await expect(service.execute('ws-1')).resolves.toBe('failed');
    await expect(service.execute('ws-1')).resolves.toBe('persisted');

    expect(repository.persistDetection).toHaveBeenCalledTimes(2);
    expect(cache.counters.get(LEDGER_GENERATION_KEY)).toBe(6);
  });

  it('decides the gate per workspace timezone at one instant', async () => {
    timezoneService.execute.mockImplementation((workspaceId) =>
      Promise.resolve(
        workspaceId === 'ws-kiritimati'
          ? 'Pacific/Kiritimati'
          : 'Pacific/Midway',
      ),
    );
    dateProvider.now.mockReturnValue(new Date('2026-07-01T02:00:00.000Z'));
    repository.findDetectionState.mockResolvedValue({
      lastBillDetectionAt: new Date('2026-06-15T12:00:00.000Z'),
    });
    repository.findBillCandidates.mockResolvedValue([]);
    repository.findActiveExpenseRules.mockResolvedValue([]);
    repository.persistDetection.mockResolvedValue('persisted');

    await expect(service.execute('ws-kiritimati')).resolves.toBe('persisted');
    await expect(service.execute('ws-midway')).resolves.toBe('not-due');

    expect(repository.persistDetection).toHaveBeenCalledTimes(1);
  });

  it('swallows timezone failures before touching candidates', async () => {
    const spy = jest.spyOn(Logger.prototype, 'error').mockImplementation();
    errorSpy = spy;
    timezoneService.execute.mockRejectedValue(new Error('cache down'));

    await expect(service.execute('ws-1')).resolves.toBe('failed');

    expect(repository.findDetectionState).not.toHaveBeenCalled();
    expect(spy).toHaveBeenCalledTimes(1);
  });
});
