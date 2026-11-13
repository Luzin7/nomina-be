import { InMemoryCacheProvider } from '@shared/cache/test-helpers/in-memory-cache';
import { Logger } from '@nestjs/common';
import { RecurringSuggestionRepository } from '@modules/transaction/repositories/contracts/RecurringSuggestionRepository';
import { makeSuggestion } from '@modules/transaction/test-helpers/mock-factories';
import { GetWorkspaceTimezoneService } from '@modules/workspace/services/get-workspace-timezone.service';
import { DateProvider } from '@providers/date/contracts/DateProvider';
import { ListRecurringSuggestionsService } from './list-recurring-suggestions.service';

const makeRepository = (): jest.Mocked<RecurringSuggestionRepository> => ({
  findDetectionState: jest.fn(),
  findBillCandidates: jest.fn(),
  findActiveExpenseRules: jest.fn(),
  persistDetection: jest.fn(),
  findPendingByWorkspace: jest.fn(),
  findByIdForWorkspace: jest.fn(),
  markShown: jest.fn(),
  accept: jest.fn(),
  dismiss: jest.fn(),
});

describe('ListRecurringSuggestionsService', () => {
  let service: ListRecurringSuggestionsService;
  let repository: jest.Mocked<RecurringSuggestionRepository>;
  let timezoneService: jest.Mocked<GetWorkspaceTimezoneService>;
  let dateProvider: jest.Mocked<DateProvider>;
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

    service = new ListRecurringSuggestionsService(
      repository,
      timezoneService,
      dateProvider,
      new InMemoryCacheProvider(),
    );
  });

  afterEach(() => {
    errorSpy?.mockRestore();
    errorSpy = undefined;
    jest.clearAllMocks();
  });

  it('returns pending suggestions without detecting twice in the same month', async () => {
    const view = {
      suggestion: makeSuggestion(),
      categoryName: 'Moradia',
      accountName: 'Conta corrente',
    };
    repository.findDetectionState.mockResolvedValue({
      lastBillDetectionAt: new Date('2026-11-05T12:00:00.000Z'),
    });
    repository.findPendingByWorkspace.mockResolvedValue([view]);

    const result = await service.execute({ workspaceId: 'ws-1' });

    expect(result.isRight()).toBe(true);
    if (result.isRight()) {
      expect(result.value.suggestions).toEqual([view]);
    }
    expect(repository.findBillCandidates).not.toHaveBeenCalled();
    expect(repository.persistDetection).not.toHaveBeenCalled();
  });

  it('detects and persists when the local month changed', async () => {
    repository.findDetectionState.mockResolvedValue({
      lastBillDetectionAt: new Date('2026-10-05T12:00:00.000Z'),
    });
    repository.findBillCandidates.mockResolvedValue([]);
    repository.findActiveExpenseRules.mockResolvedValue([]);
    repository.findPendingByWorkspace.mockResolvedValue([]);

    const result = await service.execute({ workspaceId: 'ws-1' });

    expect(result.isRight()).toBe(true);
    expect(repository.persistDetection).toHaveBeenCalledTimes(1);
    expect(repository.persistDetection).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: 'ws-1', patterns: [] }),
    );
  });

  it('returns the stored list when detection fails', async () => {
    const view = {
      suggestion: makeSuggestion(),
      categoryName: 'Moradia',
      accountName: 'Conta corrente',
    };
    const spy = jest.spyOn(Logger.prototype, 'error').mockImplementation();
    errorSpy = spy;
    repository.findDetectionState.mockRejectedValue(
      new Error('R$ 150000 Aluguel'),
    );
    repository.findPendingByWorkspace.mockResolvedValue([view]);

    const result = await service.execute({ workspaceId: 'ws-1' });

    expect(result.isRight()).toBe(true);
    if (result.isRight()) {
      expect(result.value.suggestions).toEqual([view]);
    }
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith(
      'Failed to detect recurring suggestions for workspace ws-1',
    );
    expect(spy.mock.calls.flat().join(' ')).not.toMatch(/150000|Aluguel/);
  });

  it('returns the stored list when timezone resolution fails', async () => {
    const view = {
      suggestion: makeSuggestion(),
      categoryName: 'Moradia',
      accountName: 'Conta corrente',
    };
    timezoneService.execute.mockRejectedValue(new Error('cache down'));
    repository.findPendingByWorkspace.mockResolvedValue([view]);

    const result = await service.execute({ workspaceId: 'ws-1' });

    expect(result.isRight()).toBe(true);
    if (result.isRight()) {
      expect(result.value.suggestions).toEqual([view]);
    }
    expect(repository.findDetectionState).not.toHaveBeenCalled();
  });
});
