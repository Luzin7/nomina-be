import { BudgetSuggestionUnavailableError } from '@modules/budget/errors';
import {
  BudgetRepository,
  type SuggestionWriteOutcome,
} from '@modules/budget/repositories/contracts/BudgetRepository';
import {
  ResolveBudgetSuggestionService,
  type BudgetSuggestion,
} from '@modules/budget/services/resolve-budget-suggestion.service';
import { InMemoryCacheProvider } from '@shared/cache/test-helpers/in-memory-cache';
import { readLedgerGeneration } from '@shared/cache/report-cache';
import { right } from '@shared/core/errors/Either';
import { RejectBudgetSuggestionService } from './reject-budget-suggestion.handler';

const WORKSPACE_ID = 'ws-1';

const makeSuggestion = (
  overrides: Partial<BudgetSuggestion> = {},
): BudgetSuggestion => ({
  month: '2026-11',
  monthStart: new Date('2026-11-01T03:00:00.000Z'),
  basisMonths: 3,
  income: {
    status: 'pending',
    incomeCents: 500_000,
    base: 'median',
    incomeMonths: 3,
    zeroIncomeMonths: 0,
    fingerprint: 'income-fingerprint',
  },
  split: {
    status: 'pending',
    step: 1,
    steps: 6,
    incomeBasisCents: 400_000,
    bracket: { position: 1, version: 3 },
    allocations: [],
    unmappedCategoryIds: [],
    fingerprint: 'split-fingerprint',
  },
  ...overrides,
});

describe('RejectBudgetSuggestionService', () => {
  let service: RejectBudgetSuggestionService;
  let resolver: jest.Mocked<ResolveBudgetSuggestionService>;
  let budgetRepository: jest.Mocked<BudgetRepository>;
  let cache: InMemoryCacheProvider;

  beforeEach(() => {
    resolver = {
      execute: jest.fn().mockResolvedValue(right(makeSuggestion())),
    } as unknown as jest.Mocked<ResolveBudgetSuggestionService>;
    budgetRepository = {
      saveDecision: jest.fn().mockResolvedValue('applied'),
    } as unknown as jest.Mocked<BudgetRepository>;
    cache = new InMemoryCacheProvider();
    service = new RejectBudgetSuggestionService(
      resolver,
      budgetRepository,
      cache,
    );
  });

  const givenSuggestion = (suggestion: BudgetSuggestion) =>
    resolver.execute.mockResolvedValue(right(suggestion));

  const givenOutcome = (outcome: SuggestionWriteOutcome) =>
    budgetRepository.saveDecision.mockResolvedValue(outcome);

  it('stores the rejected income base and never touches a snapshot', async () => {
    const result = await service.execute({
      workspaceId: WORKSPACE_ID,
      kind: 'income',
    });

    expect(budgetRepository.saveDecision).toHaveBeenCalledWith({
      workspaceId: WORKSPACE_ID,
      kind: 'income',
      month: '2026-11',
      decision: 'rejected',
      incomeCents: 500_000,
      bracketVersion: null,
    });
    expect(result.value).toEqual({
      kind: 'income',
      status: 'rejected',
      month: '2026-11',
    });
  });

  it('stores the split basis and bracket version on a split rejection', async () => {
    await service.execute({ workspaceId: WORKSPACE_ID, kind: 'split' });

    expect(budgetRepository.saveDecision).toHaveBeenCalledWith({
      workspaceId: WORKSPACE_ID,
      kind: 'split',
      month: '2026-11',
      decision: 'rejected',
      incomeCents: 400_000,
      bracketVersion: 3,
    });
  });

  it('invalidates the ledger reads after applying', async () => {
    await service.execute({ workspaceId: WORKSPACE_ID, kind: 'income' });

    expect(await readLedgerGeneration(cache, WORKSPACE_ID)).not.toBeNull();
  });

  it('is a no-op when the kind was already rejected', async () => {
    givenSuggestion(makeSuggestion({ income: { status: 'rejected' } }));

    const result = await service.execute({
      workspaceId: WORKSPACE_ID,
      kind: 'income',
    });

    expect(result.isRight()).toBe(true);
    expect(budgetRepository.saveDecision).not.toHaveBeenCalled();
  });

  it('refuses when there is nothing pending', async () => {
    givenSuggestion(makeSuggestion({ split: { status: 'unavailable' } }));

    const result = await service.execute({
      workspaceId: WORKSPACE_ID,
      kind: 'split',
    });

    expect(result.value).toBeInstanceOf(BudgetSuggestionUnavailableError);
    expect(budgetRepository.saveDecision).not.toHaveBeenCalled();
  });

  it('refuses when a concurrent request decided first', async () => {
    givenOutcome('already-decided');

    const result = await service.execute({
      workspaceId: WORKSPACE_ID,
      kind: 'income',
    });

    expect(result.value).toBeInstanceOf(BudgetSuggestionUnavailableError);
  });

  it('returns the rejected state when a concurrent request rejected the same kind first', async () => {
    const rejected = makeSuggestion();
    rejected.income.status = 'rejected';
    resolver.execute
      .mockResolvedValueOnce(right(makeSuggestion()))
      .mockResolvedValueOnce(right(rejected));
    givenOutcome('already-decided');

    const result = await service.execute({
      workspaceId: WORKSPACE_ID,
      kind: 'income',
    });

    expect(result.value).toEqual({
      kind: 'income',
      status: 'rejected',
      month: '2026-11',
    });
  });
});
