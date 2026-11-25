import { RecurringSuggestionRepository } from '@modules/transaction/repositories/contracts/RecurringSuggestionRepository';
import { makeSuggestion } from '@modules/transaction/test-helpers/mock-factories';
import { GetWorkspaceTimezoneService } from '@modules/workspace/services/get-workspace-timezone.service';
import { Logger } from '@nestjs/common';
import { DateProvider } from '@providers/date/contracts/DateProvider';
import { InMemoryCacheProvider } from '@shared/cache/test-helpers/in-memory-cache';
import { ListRecurringSuggestionsService } from './list-recurring-suggestions.service';

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

const makeView = () => ({
  suggestion: makeSuggestion(),
  categoryName: 'Moradia',
  accountName: 'Conta corrente',
});

describe('ListRecurringSuggestionsService', () => {
  let service: ListRecurringSuggestionsService;
  let repository: jest.Mocked<RecurringSuggestionRepository>;
  let timezoneService: jest.Mocked<GetWorkspaceTimezoneService>;
  let dateProvider: jest.Mocked<DateProvider>;

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
    jest.clearAllMocks();
  });

  it('returns the pending suggestions without running detection', async () => {
    const view = makeView();
    repository.findPendingByWorkspace.mockResolvedValue([view]);

    const result = await service.execute({ workspaceId: 'ws-1' });

    expect(result.isRight()).toBe(true);
    if (result.isRight()) {
      expect(result.value.suggestions).toEqual([view]);
    }
    expect(repository.findPendingByWorkspace).toHaveBeenCalledTimes(1);
    expect(repository.findDetectionState).not.toHaveBeenCalled();
    expect(repository.findBillCandidates).not.toHaveBeenCalled();
    expect(repository.persistDetection).not.toHaveBeenCalled();
  });

  it('returns the stored list and logs the workspace when timezone resolution fails', async () => {
    const spy = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    const view = makeView();
    timezoneService.execute.mockRejectedValue(new Error('R$ 150000 Aluguel'));
    repository.findPendingByWorkspace.mockResolvedValue([view]);

    const result = await service.execute({ workspaceId: 'ws-1' });

    expect(result.isRight()).toBe(true);
    if (result.isRight()) {
      expect(result.value.suggestions).toEqual([view]);
    }
    expect(repository.findDetectionState).not.toHaveBeenCalled();
    expect(repository.persistDetection).not.toHaveBeenCalled();
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith(
      'Timezone unavailable for workspace ws-1: Error',
    );
    expect(spy.mock.calls.flat().join(' ')).not.toMatch(/150000|Aluguel/);

    spy.mockRestore();
  });
});
