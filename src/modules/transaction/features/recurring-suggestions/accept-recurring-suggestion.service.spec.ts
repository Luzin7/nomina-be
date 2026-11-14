import { RecurringSuggestionStatus } from '@constants/enums';
import { CacheProvider } from '@infra/cache/contracts/CacheProvider';
import {
  RecurringRuleMissingError,
  RecurringSuggestionDismissedError,
  RecurringSuggestionNotFoundError,
} from '@modules/transaction/errors';
import { RecurringSuggestionRepository } from '@modules/transaction/repositories/contracts/RecurringSuggestionRepository';
import { makeSuggestion } from '@modules/transaction/test-helpers/mock-factories';
import { GetWorkspaceTimezoneService } from '@modules/workspace/services/get-workspace-timezone.service';
import { DateProvider } from '@providers/date/contracts/DateProvider';
import { AcceptRecurringSuggestionService } from './accept-recurring-suggestion.service';

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

const makeRequest = (suggestionId = 'suggestion-1') => ({
  workspaceId: 'ws-1',
  suggestionId,
});

describe('AcceptRecurringSuggestionService', () => {
  let service: AcceptRecurringSuggestionService;
  let repository: jest.Mocked<RecurringSuggestionRepository>;
  let timezoneService: jest.Mocked<GetWorkspaceTimezoneService>;
  let dateProvider: jest.Mocked<DateProvider>;
  let cacheProvider: jest.Mocked<CacheProvider>;

  beforeEach(() => {
    repository = makeRepository();
    timezoneService = {
      execute: jest.fn().mockResolvedValue('America/Sao_Paulo'),
    } as unknown as jest.Mocked<GetWorkspaceTimezoneService>;
    dateProvider = {
      now: jest.fn().mockReturnValue(new Date('2026-11-09T12:00:00.000Z')),
      format: jest.fn().mockReturnValue('2026-11-09'),
      startOfDay: jest.fn((date) => new Date(`${date}T03:00:00.000Z`)),
    } as unknown as jest.Mocked<DateProvider>;
    cacheProvider = {
      incrementCounter: jest.fn().mockResolvedValue(1),
      delByPattern: jest.fn(),
    } as unknown as jest.Mocked<CacheProvider>;

    service = new AcceptRecurringSuggestionService(
      repository,
      timezoneService,
      dateProvider,
      cacheProvider,
    );
  });

  afterEach(() => jest.clearAllMocks());

  it('returns the same recurring id when replayed', async () => {
    repository.findByIdForWorkspace.mockResolvedValue(
      makeSuggestion({
        status: RecurringSuggestionStatus.ACCEPTED,
        recurringId: 'rec-1',
      }),
    );
    repository.accept.mockResolvedValue({
      kind: 'already-accepted',
      recurringId: 'rec-1',
    });

    const result = await service.execute(makeRequest());

    expect(result.isRight()).toBe(true);
    if (result.isRight()) expect(result.value.recurringId).toBe('rec-1');
    expect(cacheProvider.incrementCounter).not.toHaveBeenCalled();
  });

  it('reports a missing rule when the accepted suggestion lost its link', async () => {
    repository.findByIdForWorkspace.mockResolvedValue(
      makeSuggestion({ status: RecurringSuggestionStatus.ACCEPTED }),
    );
    repository.accept.mockResolvedValue({
      kind: 'already-accepted',
      recurringId: null,
    });

    const result = await service.execute(makeRequest());

    expect(result.isLeft()).toBe(true);
    expect(result.value).toBeInstanceOf(RecurringRuleMissingError);
    expect(cacheProvider.incrementCounter).not.toHaveBeenCalled();
  });

  it('rejects a dismissed suggestion', async () => {
    repository.findByIdForWorkspace.mockResolvedValue(
      makeSuggestion({ status: RecurringSuggestionStatus.DISMISSED }),
    );

    const result = await service.execute(makeRequest());

    expect(result.isLeft()).toBe(true);
    expect(result.value).toBeInstanceOf(RecurringSuggestionDismissedError);
    expect(repository.accept).not.toHaveBeenCalled();
  });

  it('returns not found when the suggestion belongs to another workspace', async () => {
    repository.findByIdForWorkspace.mockResolvedValue(null);

    const result = await service.execute(makeRequest());

    expect(result.isLeft()).toBe(true);
    expect(result.value).toBeInstanceOf(RecurringSuggestionNotFoundError);
    expect(repository.accept).not.toHaveBeenCalled();
    expect(cacheProvider.incrementCounter).not.toHaveBeenCalled();
  });

  it('accepts a pending suggestion and bumps the report cache', async () => {
    repository.findByIdForWorkspace.mockResolvedValue(makeSuggestion());
    repository.accept.mockResolvedValue({
      kind: 'accepted',
      recurringId: 'rec-1',
    });

    const result = await service.execute(makeRequest());

    expect(result.isRight()).toBe(true);
    if (result.isRight()) expect(result.value.recurringId).toBe('rec-1');
    expect(cacheProvider.incrementCounter).toHaveBeenCalledWith(
      'cache-gen:report:ws-1',
      expect.any(Number),
    );
  });

  it('computes a strictly future start date from the suggestion day', async () => {
    repository.findByIdForWorkspace.mockResolvedValue(
      makeSuggestion({ dayOfMonth: 9 }),
    );
    repository.accept.mockResolvedValue({
      kind: 'accepted',
      recurringId: 'rec-1',
    });

    await service.execute(makeRequest());

    expect(dateProvider.startOfDay).toHaveBeenCalledWith(
      '2026-12-09',
      'America/Sao_Paulo',
    );
  });

  it('clamps day 31 to the last day of February', async () => {
    dateProvider.format.mockReturnValue('2026-02-10');
    repository.findByIdForWorkspace.mockResolvedValue(
      makeSuggestion({ dayOfMonth: 31 }),
    );
    repository.accept.mockResolvedValue({
      kind: 'accepted',
      recurringId: 'rec-1',
    });

    await service.execute(makeRequest());

    expect(dateProvider.startOfDay).toHaveBeenCalledWith(
      '2026-02-28',
      'America/Sao_Paulo',
    );
  });

  it('clamps day 31 to the last day of a 30-day month', async () => {
    dateProvider.format.mockReturnValue('2026-04-10');
    repository.findByIdForWorkspace.mockResolvedValue(
      makeSuggestion({ dayOfMonth: 31 }),
    );
    repository.accept.mockResolvedValue({
      kind: 'accepted',
      recurringId: 'rec-1',
    });

    await service.execute(makeRequest());

    expect(dateProvider.startOfDay).toHaveBeenCalledWith(
      '2026-04-30',
      'America/Sao_Paulo',
    );
  });

  it('maps a concurrent dismissal to the dismissed conflict', async () => {
    repository.findByIdForWorkspace.mockResolvedValue(makeSuggestion());
    repository.accept.mockResolvedValue({ kind: 'dismissed' });

    const result = await service.execute(makeRequest());

    expect(result.isLeft()).toBe(true);
    expect(result.value).toBeInstanceOf(RecurringSuggestionDismissedError);
    expect(cacheProvider.incrementCounter).not.toHaveBeenCalled();
  });

  it('maps a missing suggestion detected inside the transaction to not found', async () => {
    repository.findByIdForWorkspace.mockResolvedValue(makeSuggestion());
    repository.accept.mockResolvedValue({ kind: 'not-found' });

    const result = await service.execute(makeRequest());

    expect(result.isLeft()).toBe(true);
    expect(result.value).toBeInstanceOf(RecurringSuggestionNotFoundError);
  });

  it('uses an edited title on the created rule', async () => {
    repository.findByIdForWorkspace.mockResolvedValue(makeSuggestion());
    repository.accept.mockResolvedValue({
      kind: 'accepted',
      recurringId: 'rec-1',
    });

    await service.execute({ ...makeRequest(), title: 'Aluguel ajustado' });

    const [{ rule }] = repository.accept.mock.calls[0];
    expect(rule.title).toBe('Aluguel ajustado');
  });

  it('falls back to the suggested title when no title is sent', async () => {
    repository.findByIdForWorkspace.mockResolvedValue(makeSuggestion());
    repository.accept.mockResolvedValue({
      kind: 'accepted',
      recurringId: 'rec-1',
    });

    await service.execute(makeRequest());

    const [{ rule }] = repository.accept.mock.calls[0];
    expect(rule.title).toBe('Aluguel');
  });
});
