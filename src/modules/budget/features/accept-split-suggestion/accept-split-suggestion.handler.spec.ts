import {
  BudgetSuggestionChangedError,
  BudgetSuggestionUnavailableError,
} from '@modules/budget/errors';
import {
  BudgetRepository,
  type SuggestionWriteOutcome,
} from '@modules/budget/repositories/contracts/BudgetRepository';
import {
  ResolveBudgetSuggestionService,
  type BudgetSuggestion,
  type SplitSuggestionState,
} from '@modules/budget/services/resolve-budget-suggestion.service';
import { InMemoryCacheProvider } from '@shared/cache/test-helpers/in-memory-cache';
import { readLedgerGeneration } from '@shared/cache/report-cache';
import { right } from '@shared/core/errors/Either';
import { AcceptSplitSuggestionService } from './accept-split-suggestion.handler';

const WORKSPACE_ID = 'ws-1';
const FINGERPRINT = 'fingerprint-1';
const MONTH_START = new Date('2026-11-01T03:00:00.000Z');

const makePendingSplit = (
  overrides: Partial<SplitSuggestionState> = {},
): SplitSuggestionState =>
  ({
    status: 'pending',
    step: 1,
    steps: 6,
    incomeBasisCents: 500_000,
    bracket: { position: 1, version: 3 },
    allocations: [
      {
        categoryId: 'cat-1',
        group: 'essentials',
        actualCents: 200_000,
        idealCents: 250_000,
        suggestedCents: 210_000,
      },
    ],
    unmappedCategoryIds: [],
    fingerprint: FINGERPRINT,
    ...overrides,
  }) as SplitSuggestionState;

const makeSuggestion = (split: SplitSuggestionState): BudgetSuggestion => ({
  month: '2026-11',
  monthStart: MONTH_START,
  basisMonths: 3,
  income: { status: 'set' },
  split,
});

describe('AcceptSplitSuggestionService', () => {
  let service: AcceptSplitSuggestionService;
  let resolver: jest.Mocked<ResolveBudgetSuggestionService>;
  let budgetRepository: jest.Mocked<BudgetRepository>;
  let cache: InMemoryCacheProvider;

  beforeEach(() => {
    resolver = {
      execute: jest
        .fn()
        .mockResolvedValue(right(makeSuggestion(makePendingSplit()))),
    } as unknown as jest.Mocked<ResolveBudgetSuggestionService>;
    budgetRepository = {
      saveSnapshotWithDecision: jest.fn().mockResolvedValue('applied'),
    } as unknown as jest.Mocked<BudgetRepository>;
    cache = new InMemoryCacheProvider();
    service = new AcceptSplitSuggestionService(
      resolver,
      budgetRepository,
      cache,
    );
  });

  const accept = (fingerprint = FINGERPRINT) =>
    service.execute({ workspaceId: WORKSPACE_ID, fingerprint });

  const givenOutcome = (outcome: SuggestionWriteOutcome) =>
    budgetRepository.saveSnapshotWithDecision.mockResolvedValue(outcome);

  const givenSplit = (split: SplitSuggestionState) =>
    resolver.execute.mockResolvedValue(right(makeSuggestion(split)));

  it('writes the suggested allocations with the bracket version', async () => {
    const result = await accept();

    expect(budgetRepository.saveSnapshotWithDecision).toHaveBeenCalledWith({
      isStillCurrent: expect.any(Function),
      workspaceId: WORKSPACE_ID,
      effectiveFrom: MONTH_START,
      expectedMonthlyIncome: 500_000,
      decision: {
        workspaceId: WORKSPACE_ID,
        kind: 'split',
        month: '2026-11',
        decision: 'accepted',
        incomeCents: 500_000,
        bracketVersion: 3,
      },
      write: {
        kind: 'split',
        allocations: [
          {
            categoryId: 'cat-1',
            groupName: 'Essenciais',
            groupOrder: 0,
            categoryOrder: 0,
            targetCents: 210_000,
          },
        ],
      },
    });
    expect(result.value).toEqual({
      kind: 'split',
      status: 'accepted',
      month: '2026-11',
    });
  });

  const freshnessCheck = (): (() => Promise<boolean>) =>
    budgetRepository.saveSnapshotWithDecision.mock.calls[0][0].isStillCurrent;

  it('confirms freshness when the recomputed suggestion has the same fingerprint', async () => {
    await accept();

    expect(await freshnessCheck()()).toBe(true);
  });

  it('denies freshness when the recomputed fingerprint differs', async () => {
    await accept();
    givenSplit(makePendingSplit({ fingerprint: 'other' }));

    expect(await freshnessCheck()()).toBe(false);
  });

  it('denies freshness when the split is no longer pending', async () => {
    await accept();
    givenSplit({ status: 'complete' });

    expect(await freshnessCheck()()).toBe(false);
  });

  it('records a null income and bracket when there is no income basis', async () => {
    givenSplit(makePendingSplit({ incomeBasisCents: null, bracket: null }));

    await accept();

    expect(budgetRepository.saveSnapshotWithDecision).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedMonthlyIncome: null,
        decision: expect.objectContaining({
          incomeCents: null,
          bracketVersion: null,
        }),
      }),
    );
  });

  it('invalidates the ledger reads after applying', async () => {
    await accept();

    expect(await readLedgerGeneration(cache, WORKSPACE_ID)).not.toBeNull();
  });

  it('rejects a stale fingerprint without writing', async () => {
    const result = await accept('other');

    expect(result.value).toBeInstanceOf(BudgetSuggestionChangedError);
    expect(budgetRepository.saveSnapshotWithDecision).not.toHaveBeenCalled();
  });

  it('is a no-op when the split was already accepted', async () => {
    givenSplit({ status: 'accepted' });

    const result = await accept();

    expect(result.isRight()).toBe(true);
    expect(budgetRepository.saveSnapshotWithDecision).not.toHaveBeenCalled();
  });

  it.each(['rejected', 'complete', 'unavailable'] as const)(
    'refuses when the split is %s',
    async (status) => {
      givenSplit({ status });

      const result = await accept();

      expect(result.value).toBeInstanceOf(BudgetSuggestionUnavailableError);
    },
  );

  it('refuses when every suggested target is zero', async () => {
    givenSplit(
      makePendingSplit({
        allocations: [
          {
            categoryId: 'cat-1',
            group: null,
            actualCents: 0,
            idealCents: null,
            suggestedCents: 0,
          },
        ],
      }),
    );

    const result = await accept();

    expect(result.value).toBeInstanceOf(BudgetSuggestionUnavailableError);
  });

  it('reports a change when the snapshot income drifted', async () => {
    givenOutcome('drifted');

    const result = await accept();

    expect(result.value).toBeInstanceOf(BudgetSuggestionChangedError);
  });

  it('succeeds when a concurrent request accepted first', async () => {
    givenOutcome('already-decided');
    resolver.execute
      .mockResolvedValueOnce(right(makeSuggestion(makePendingSplit())))
      .mockResolvedValueOnce(right(makeSuggestion({ status: 'accepted' })));

    const result = await accept();

    expect(result.isRight()).toBe(true);
  });

  it('refuses when a concurrent request decided differently', async () => {
    givenOutcome('already-decided');
    resolver.execute
      .mockResolvedValueOnce(right(makeSuggestion(makePendingSplit())))
      .mockResolvedValueOnce(right(makeSuggestion({ status: 'rejected' })));

    const result = await accept();

    expect(result.value).toBeInstanceOf(BudgetSuggestionUnavailableError);
  });
});
