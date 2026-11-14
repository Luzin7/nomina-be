import { InMemoryCacheProvider } from '@shared/cache/test-helpers/in-memory-cache';
import { RecurringSuggestionRepository } from '@modules/transaction/repositories/contracts/RecurringSuggestionRepository';
import { MarkRecurringSuggestionsShownService } from './mark-recurring-suggestions-shown.service';

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

describe('MarkRecurringSuggestionsShownService', () => {
  let service: MarkRecurringSuggestionsShownService;
  let repository: jest.Mocked<RecurringSuggestionRepository>;

  beforeEach(() => {
    repository = makeRepository();
    service = new MarkRecurringSuggestionsShownService(
      repository,
      new InMemoryCacheProvider(),
    );
  });

  afterEach(() => jest.clearAllMocks());

  it('returns only the ids that were actually marked as shown', async () => {
    repository.markShown.mockResolvedValue(['suggestion-1']);

    const result = await service.execute({
      workspaceId: 'ws-1',
      ids: ['suggestion-1', 'foreign-1'],
    });

    expect(result.isRight()).toBe(true);
    if (result.isRight())
      expect(result.value).toEqual({ ids: ['suggestion-1'] });
    expect(repository.markShown).toHaveBeenCalledWith('ws-1', [
      'suggestion-1',
      'foreign-1',
    ]);
  });

  it('returns an empty list when nothing belongs to the workspace', async () => {
    repository.markShown.mockResolvedValue([]);

    const result = await service.execute({
      workspaceId: 'ws-1',
      ids: ['foreign-1'],
    });

    expect(result.isRight()).toBe(true);
    if (result.isRight()) expect(result.value).toEqual({ ids: [] });
  });
});
