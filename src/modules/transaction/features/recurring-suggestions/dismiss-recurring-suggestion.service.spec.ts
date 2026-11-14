import { RecurringSuggestionStatus } from '@constants/enums';
import { CacheProvider } from '@infra/cache/contracts/CacheProvider';
import {
  RecurringSuggestionAlreadyAcceptedError,
  RecurringSuggestionNotFoundError,
} from '@modules/transaction/errors';
import { RecurringSuggestionRepository } from '@modules/transaction/repositories/contracts/RecurringSuggestionRepository';
import { makeSuggestion } from '@modules/transaction/test-helpers/mock-factories';
import { DismissRecurringSuggestionService } from './dismiss-recurring-suggestion.service';

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

describe('DismissRecurringSuggestionService', () => {
  let service: DismissRecurringSuggestionService;
  let repository: jest.Mocked<RecurringSuggestionRepository>;
  let cacheProvider: jest.Mocked<CacheProvider>;

  beforeEach(() => {
    repository = makeRepository();
    cacheProvider = {
      incrementCounter: jest.fn().mockResolvedValue(1),
      delByPattern: jest.fn(),
    } as unknown as jest.Mocked<CacheProvider>;

    service = new DismissRecurringSuggestionService(repository, cacheProvider);
  });

  afterEach(() => jest.clearAllMocks());

  const request = { workspaceId: 'ws-1', suggestionId: 'suggestion-1' };

  it('returns not found for another workspace', async () => {
    repository.findByIdForWorkspace.mockResolvedValue(null);

    const result = await service.execute(request);

    expect(result.isLeft()).toBe(true);
    expect(result.value).toBeInstanceOf(RecurringSuggestionNotFoundError);
    expect(repository.dismiss).not.toHaveBeenCalled();
  });

  it('is idempotent when the suggestion is already dismissed', async () => {
    repository.findByIdForWorkspace.mockResolvedValue(
      makeSuggestion({ status: RecurringSuggestionStatus.DISMISSED }),
    );

    const result = await service.execute(request);

    expect(result.isRight()).toBe(true);
    if (result.isRight()) expect(result.value.status).toBe('dismissed');
    expect(repository.dismiss).not.toHaveBeenCalled();
    expect(cacheProvider.incrementCounter).not.toHaveBeenCalled();
  });

  it('rejects a suggestion already turned into a recurrence', async () => {
    repository.findByIdForWorkspace.mockResolvedValue(
      makeSuggestion({
        status: RecurringSuggestionStatus.ACCEPTED,
        recurringId: 'rec-1',
      }),
    );

    const result = await service.execute(request);

    expect(result.isLeft()).toBe(true);
    expect(result.value).toBeInstanceOf(
      RecurringSuggestionAlreadyAcceptedError,
    );
  });

  it('dismisses a pending suggestion and bumps the report cache', async () => {
    repository.findByIdForWorkspace.mockResolvedValue(makeSuggestion());
    repository.dismiss.mockResolvedValue({ kind: 'dismissed' });

    const result = await service.execute(request);

    expect(result.isRight()).toBe(true);
    if (result.isRight()) {
      expect(result.value).toEqual({
        id: 'suggestion-1',
        status: 'dismissed',
      });
    }
    expect(repository.dismiss).toHaveBeenCalledWith({
      suggestionId: 'suggestion-1',
      workspaceId: 'ws-1',
    });
    expect(cacheProvider.incrementCounter).toHaveBeenCalledWith(
      'cache-gen:report:ws-1',
      expect.any(Number),
    );
  });

  it('maps a concurrent acceptance to the conflict', async () => {
    repository.findByIdForWorkspace.mockResolvedValue(makeSuggestion());
    repository.dismiss.mockResolvedValue({ kind: 'already-accepted' });

    const result = await service.execute(request);

    expect(result.isLeft()).toBe(true);
    expect(result.value).toBeInstanceOf(
      RecurringSuggestionAlreadyAcceptedError,
    );
    expect(cacheProvider.incrementCounter).not.toHaveBeenCalled();
  });
});
