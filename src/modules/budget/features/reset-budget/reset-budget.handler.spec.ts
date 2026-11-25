import { type BudgetMode } from '@constants/enums';
import {
  BudgetResetUnavailableError,
  BudgetSuggestionChangedError,
} from '@modules/budget/errors';
import {
  BudgetRepository,
  type ResetSnapshotOutcome,
} from '@modules/budget/repositories/contracts/BudgetRepository';
import {
  ResolveBudgetSuggestionService,
  type BudgetSuggestion,
  type SplitSuggestionState,
  type SuggestedPlan,
} from '@modules/budget/services/resolve-budget-suggestion.service';
import { invalidateLedgerReads } from '@shared/cache/report-cache';
import { InMemoryCacheProvider } from '@shared/cache/test-helpers/in-memory-cache';
import { right } from '@shared/core/errors/Either';
import { captureException } from '@sentry/nestjs';
import { ResetBudgetService } from './reset-budget.handler';

jest.mock('@sentry/nestjs', () => ({ captureException: jest.fn() }));

jest.mock('@shared/cache/report-cache', () => {
  const actual = jest.requireActual('@shared/cache/report-cache');

  return {
    ...actual,
    invalidateLedgerReads: jest.fn(actual.invalidateLedgerReads),
  };
});

const WORKSPACE_ID = 'ws-1';
const MONTH_START = new Date('2026-11-01T03:00:00.000Z');
const MONTHLY_INCOME = 500_000;

const planOf = (allocations: SuggestedPlan['allocations']): SuggestedPlan => ({
  allocations,
  planTotalCents: allocations.reduce(
    (total, allocation) => total + allocation.suggestedCents,
    0,
  ),
  basisMonths: 3,
});

const PLAN = planOf([
  {
    categoryId: 'cat-1',
    group: 'essentials',
    actualCents: 200_000,
    idealCents: 250_000,
    suggestedCents: 210_000,
  },
  {
    categoryId: 'cat-2',
    group: null,
    actualCents: 30_000,
    idealCents: null,
    suggestedCents: 30_000,
  },
  {
    categoryId: 'cat-3',
    group: 'lifestyle',
    actualCents: 0,
    idealCents: 0,
    suggestedCents: 0,
  },
]);

const makeSuggestion = (
  overrides: Partial<BudgetSuggestion> = {},
  split: SplitSuggestionState = { status: 'accepted' },
): BudgetSuggestion => ({
  month: '2026-11',
  monthStart: MONTH_START,
  basisMonths: 3,
  income: { status: 'set' },
  split,
  plan: PLAN,
  planEligible: true,
  ...overrides,
});

const snapshotOf = (monthlyIncome: number | null) => ({
  id: 'budget-previous',
  workspaceId: WORKSPACE_ID,
  effectiveFrom: new Date('2026-10-01T03:00:00.000Z'),
  monthlyIncome,
  mode: 'percentage' as const,
  allocations: [],
});

const outcomeOf = (mode: BudgetMode): ResetSnapshotOutcome => ({
  status: 'applied',
  snapshot: { id: 'budget-1', effectiveFrom: MONTH_START },
  mode,
});

describe('ResetBudgetService', () => {
  let service: ResetBudgetService;
  let resolver: jest.Mocked<ResolveBudgetSuggestionService>;
  let budgetRepository: jest.Mocked<BudgetRepository>;
  let cache: InMemoryCacheProvider;

  beforeEach(() => {
    jest.clearAllMocks();
    resolver = {
      resolveFromBlankBaseline: jest
        .fn()
        .mockResolvedValue(right(makeSuggestion())),
      resolveFresh: jest.fn(),
      execute: jest.fn(),
    } as unknown as jest.Mocked<ResolveBudgetSuggestionService>;
    budgetRepository = {
      resolveSnapshot: jest.fn().mockResolvedValue(snapshotOf(MONTHLY_INCOME)),
      resetSnapshot: jest.fn().mockResolvedValue(outcomeOf('percentage')),
    } as unknown as jest.Mocked<BudgetRepository>;
    cache = new InMemoryCacheProvider();
    service = new ResetBudgetService(resolver, budgetRepository, cache);
  });

  const reset = () => service.execute({ workspaceId: WORKSPACE_ID });

  const givenOutcome = (outcome: ResetSnapshotOutcome) =>
    budgetRepository.resetSnapshot.mockResolvedValue(outcome);

  const writeInputOf = (call: number) => {
    const { allocations, decision } =
      budgetRepository.resetSnapshot.mock.calls[call][0];

    return { allocations, decision };
  };

  it('reads the plan from the blank baseline instead of the stored targets', async () => {
    await reset();

    expect(resolver.resolveFromBlankBaseline).toHaveBeenCalledWith({
      workspaceId: WORKSPACE_ID,
    });
    expect(resolver.resolveFresh).not.toHaveBeenCalled();
  });

  it('writes the suggested targets, dropping the zero ones', async () => {
    await reset();

    expect(budgetRepository.resetSnapshot).toHaveBeenCalledWith({
      isStillCurrent: expect.any(Function),
      workspaceId: WORKSPACE_ID,
      effectiveFrom: MONTH_START,
      decision: {
        workspaceId: WORKSPACE_ID,
        kind: 'reset',
        month: '2026-11',
        decision: 'accepted',
        incomeCents: MONTHLY_INCOME,
        bracketVersion: null,
      },
      allocations: [
        {
          categoryId: 'cat-1',
          groupName: 'Essenciais',
          groupOrder: 0,
          categoryOrder: 0,
          targetCents: 210_000,
        },
        {
          categoryId: 'cat-2',
          groupName: 'Sem grupo',
          groupOrder: 3,
          categoryOrder: 0,
          targetCents: 30_000,
        },
      ],
    });
  });

  it('writes the same payload on two consecutive resets', async () => {
    await reset();
    await reset();

    expect(writeInputOf(1)).toEqual(writeInputOf(0));
  });

  it('answers with the mode the repository preserved', async () => {
    givenOutcome(outcomeOf('percentage'));

    const result = await reset();

    expect(result.value).toEqual({
      id: 'budget-1',
      effectiveFrom: MONTH_START,
      mode: 'percentage',
      monthlyIncomeCents: MONTHLY_INCOME,
      totalTargetCents: 240_000,
      unallocatedIncomeCents: 260_000,
      allocationState: 'under',
    });
  });

  it('refuses without a suggested plan', async () => {
    resolver.resolveFromBlankBaseline.mockResolvedValue(
      right(makeSuggestion({ plan: null })),
    );

    const result = await reset();

    expect(result.value).toBeInstanceOf(BudgetResetUnavailableError);
    expect(budgetRepository.resetSnapshot).not.toHaveBeenCalled();
  });

  it('refuses without a declared income', async () => {
    budgetRepository.resolveSnapshot.mockResolvedValue(snapshotOf(null));

    const result = await reset();

    expect(result.value).toBeInstanceOf(BudgetResetUnavailableError);
    expect(budgetRepository.resetSnapshot).not.toHaveBeenCalled();
  });

  it('refuses when every suggested target is zero', async () => {
    resolver.resolveFromBlankBaseline.mockResolvedValue(
      right(
        makeSuggestion({
          plan: planOf([
            {
              categoryId: 'cat-1',
              group: null,
              actualCents: 0,
              idealCents: 0,
              suggestedCents: 0,
            },
          ]),
        }),
      ),
    );

    const result = await reset();

    expect(result.value).toBeInstanceOf(BudgetResetUnavailableError);
    expect(budgetRepository.resetSnapshot).not.toHaveBeenCalled();
  });

  it('captures the unavailable exit', async () => {
    budgetRepository.resolveSnapshot.mockResolvedValue(snapshotOf(null));

    const result = await reset();

    expect(captureException).toHaveBeenCalledWith(result.value, {
      extra: { workspaceId: WORKSPACE_ID },
    });
  });

  it('reports a change when the suggestion drifted', async () => {
    givenOutcome({ status: 'drifted' });

    const result = await reset();

    expect(result.value).toBeInstanceOf(BudgetSuggestionChangedError);
    expect(invalidateLedgerReads).not.toHaveBeenCalled();
  });

  it('captures the drifted exit', async () => {
    givenOutcome({ status: 'drifted' });

    const result = await reset();

    expect(captureException).toHaveBeenCalledWith(result.value, {
      extra: { workspaceId: WORKSPACE_ID },
    });
  });

  const freshnessCheck = (): (() => Promise<boolean>) =>
    budgetRepository.resetSnapshot.mock.calls[0][0].isStillCurrent;

  it('confirms freshness when the suggestion did not change', async () => {
    await reset();

    expect(await freshnessCheck()()).toBe(true);
  });

  it('denies freshness when the plan targets changed', async () => {
    await reset();
    resolver.resolveFromBlankBaseline.mockResolvedValue(
      right(
        makeSuggestion({
          plan: planOf([
            {
              categoryId: 'cat-1',
              group: 'essentials',
              actualCents: 200_000,
              idealCents: 250_000,
              suggestedCents: 220_000,
            },
          ]),
        }),
      ),
    );

    expect(await freshnessCheck()()).toBe(false);
  });

  it('denies freshness when the declared income changed', async () => {
    await reset();
    budgetRepository.resolveSnapshot.mockResolvedValue(snapshotOf(600_000));

    expect(await freshnessCheck()()).toBe(false);
  });

  it('invalidates the ledger reads under the reset reason', async () => {
    await reset();

    expect(invalidateLedgerReads).toHaveBeenCalledWith(
      cache,
      WORKSPACE_ID,
      'reset-budget',
    );
  });
});
