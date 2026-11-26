import {
  BudgetSuggestionChangedError,
  BudgetSuggestionUnavailableError,
  InvalidBudgetTargetError,
  NonRootBudgetCategoryError,
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
import { ValidateBudgetAllocationsService } from '@modules/budget/services/validate-budget-allocations.service';
import { InMemoryCacheProvider } from '@shared/cache/test-helpers/in-memory-cache';
import { readLedgerGeneration } from '@shared/cache/report-cache';
import { right } from '@shared/core/errors/Either';
import { planTotalOf } from '@modules/budget/valueObjects/SplitAllocationLayout';
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
    unallocatedCents: 0,
    fingerprint: FINGERPRINT,
    ...overrides,
  }) as SplitSuggestionState;

const makeSuggestion = (split: SplitSuggestionState): BudgetSuggestion => ({
  month: '2026-11',
  monthStart: MONTH_START,
  basisMonths: 3,
  income: { status: 'set' },
  split,
  plan: null,
  planEligible: false,
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
        .mockResolvedValue(
          right(makeSuggestion(makePendingSplit({ fingerprint: 'stale' }))),
        ),
      resolveFresh: jest
        .fn()
        .mockResolvedValue(right(makeSuggestion(makePendingSplit()))),
    } as unknown as jest.Mocked<ResolveBudgetSuggestionService>;
    budgetRepository = {
      saveSnapshotWithDecision: jest.fn().mockResolvedValue('applied'),
      findCategoriesByIds: jest.fn().mockImplementation(async (ids: string[]) =>
        ids.map((id) => ({
          id,
          name: id,
          workspaceId: WORKSPACE_ID,
          parentId: null,
          isHidden: false,
        })),
      ),
      resolveSnapshot: jest.fn().mockResolvedValue(null),
    } as unknown as jest.Mocked<BudgetRepository>;
    cache = new InMemoryCacheProvider();
    service = new AcceptSplitSuggestionService(
      resolver,
      budgetRepository,
      new ValidateBudgetAllocationsService(budgetRepository),
      cache,
    );
  });

  const accept = (
    fingerprint = FINGERPRINT,
    allocations?: { categoryId: string; targetCents: number }[],
  ) => service.execute({ workspaceId: WORKSPACE_ID, fingerprint, allocations });

  const givenOutcome = (outcome: SuggestionWriteOutcome) =>
    budgetRepository.saveSnapshotWithDecision.mockResolvedValue(outcome);

  const givenSplit = (split: SplitSuggestionState) =>
    resolver.resolveFresh.mockResolvedValue(right(makeSuggestion(split)));

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

  it('saves targets that add up to the plan total', async () => {
    const split = makePendingSplit({
      allocations: [
        {
          categoryId: 'cat-1',
          group: 'essentials',
          actualCents: 200_000,
          idealCents: 250_000,
          suggestedCents: 210_000,
        },
        {
          categoryId: 'cat-2',
          group: 'lifestyle',
          actualCents: 80_000,
          idealCents: 90_000,
          suggestedCents: 85_000,
        },
      ],
    });
    if (split.status !== 'pending') throw new Error('split not pending');
    const plan = {
      allocations: split.allocations,
      planTotalCents: planTotalOf(split.allocations),
      basisMonths: 3,
    };
    resolver.resolveFresh.mockResolvedValue(
      right({ ...makeSuggestion(split), plan }),
    );

    await accept();

    const { write } =
      budgetRepository.saveSnapshotWithDecision.mock.calls[0][0];
    if (write.kind !== 'split') throw new Error('not a split write');
    const saved = write.allocations.reduce(
      (total, { targetCents }) => total + targetCents,
      0,
    );
    expect(saved).toBe(plan.planTotalCents);
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
    resolver.resolveFresh
      .mockResolvedValueOnce(right(makeSuggestion(makePendingSplit())))
      .mockResolvedValueOnce(right(makeSuggestion({ status: 'accepted' })));

    const result = await accept();

    expect(result.isRight()).toBe(true);
  });

  it('refuses when a concurrent request decided differently', async () => {
    givenOutcome('already-decided');
    resolver.resolveFresh
      .mockResolvedValueOnce(right(makeSuggestion(makePendingSplit())))
      .mockResolvedValueOnce(right(makeSuggestion({ status: 'rejected' })));

    const result = await accept();

    expect(result.value).toBeInstanceOf(BudgetSuggestionUnavailableError);
  });

  it('never reads the cached suggestion on any step of the write path', async () => {
    givenOutcome('already-decided');
    resolver.resolveFresh
      .mockResolvedValueOnce(right(makeSuggestion(makePendingSplit())))
      .mockResolvedValueOnce(right(makeSuggestion({ status: 'accepted' })));

    await accept();
    await budgetRepository.saveSnapshotWithDecision.mock.calls[0]?.[0].isStillCurrent();

    expect(resolver.execute).not.toHaveBeenCalled();
  });

  describe('with edited allocations', () => {
    it('writes the edited targets keeping the suggested group and the basis income', async () => {
      const result = await accept(FINGERPRINT, [
        { categoryId: 'cat-1', targetCents: 180_000 },
        { categoryId: 'cat-2', targetCents: 40_000 },
      ]);

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
              targetCents: 180_000,
            },
            {
              categoryId: 'cat-2',
              groupName: 'Sem grupo',
              groupOrder: 3,
              categoryOrder: 0,
              targetCents: 40_000,
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

    it('invalidates the ledger reads after applying', async () => {
      await accept(FINGERPRINT, [{ categoryId: 'cat-1', targetCents: 1 }]);

      expect(await readLedgerGeneration(cache, WORKSPACE_ID)).not.toBeNull();
    });

    it('rejects a subcategory without writing', async () => {
      budgetRepository.findCategoriesByIds.mockResolvedValue([
        {
          id: 'cat-1',
          name: 'cat-1',
          workspaceId: WORKSPACE_ID,
          parentId: 'parent-1',
          isHidden: false,
        },
      ]);

      const result = await accept(FINGERPRINT, [
        { categoryId: 'cat-1', targetCents: 1 },
      ]);

      expect(result.value).toBeInstanceOf(NonRootBudgetCategoryError);
      expect(budgetRepository.saveSnapshotWithDecision).not.toHaveBeenCalled();
    });

    it('rejects non-integer cents without writing', async () => {
      const result = await accept(FINGERPRINT, [
        { categoryId: 'cat-1', targetCents: 10.5 },
      ]);

      expect(result.value).toBeInstanceOf(InvalidBudgetTargetError);
      expect(budgetRepository.saveSnapshotWithDecision).not.toHaveBeenCalled();
    });

    it('reports a change for a stale fingerprint before validating', async () => {
      const result = await accept('other', [
        { categoryId: 'cat-1', targetCents: 1 },
      ]);

      expect(result.value).toBeInstanceOf(BudgetSuggestionChangedError);
      expect(budgetRepository.findCategoriesByIds).not.toHaveBeenCalled();
      expect(budgetRepository.saveSnapshotWithDecision).not.toHaveBeenCalled();
    });

    it('is a no-op when the split was already accepted', async () => {
      givenSplit({ status: 'accepted' });

      const result = await accept(FINGERPRINT, [
        { categoryId: 'cat-1', targetCents: 1 },
      ]);

      expect(result.isRight()).toBe(true);
      expect(budgetRepository.findCategoriesByIds).not.toHaveBeenCalled();
      expect(budgetRepository.saveSnapshotWithDecision).not.toHaveBeenCalled();
    });

    it('refuses when every edited target is zero', async () => {
      const result = await accept(FINGERPRINT, [
        { categoryId: 'cat-1', targetCents: 0 },
      ]);

      expect(result.value).toBeInstanceOf(BudgetSuggestionUnavailableError);
      expect(budgetRepository.saveSnapshotWithDecision).not.toHaveBeenCalled();
    });
  });
});
