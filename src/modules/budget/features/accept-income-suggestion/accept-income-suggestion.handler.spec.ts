import {
  BudgetSuggestionChangedError,
  BudgetSuggestionUnavailableError,
} from '@modules/budget/errors';
import {
  BudgetRepository,
  type SaveSnapshotWithDecisionInput,
  type SuggestionWriteOutcome,
} from '@modules/budget/repositories/contracts/BudgetRepository';
import {
  ResolveBudgetSuggestionService,
  type BudgetSuggestion,
  type IncomeSuggestion,
} from '@modules/budget/services/resolve-budget-suggestion.service';
import { InMemoryCacheProvider } from '@shared/cache/test-helpers/in-memory-cache';
import { readLedgerGeneration } from '@shared/cache/report-cache';
import { right } from '@shared/core/errors/Either';
import { AcceptIncomeSuggestionService } from './accept-income-suggestion.handler';

const WORKSPACE_ID = 'ws-1';
const FINGERPRINT = 'fingerprint-1';
const MONTH_START = new Date('2026-11-01T03:00:00.000Z');

const makePendingIncome = (
  overrides: Partial<IncomeSuggestion> = {},
): IncomeSuggestion =>
  ({
    status: 'pending',
    incomeCents: 500_000,
    base: 'median',
    incomeMonths: 3,
    zeroIncomeMonths: 0,
    fingerprint: FINGERPRINT,
    ...overrides,
  }) as IncomeSuggestion;

const makeSuggestion = (income: IncomeSuggestion): BudgetSuggestion => ({
  month: '2026-11',
  monthStart: MONTH_START,
  basisMonths: 3,
  income,
  split: { status: 'unavailable' },
});

describe('AcceptIncomeSuggestionService', () => {
  let service: AcceptIncomeSuggestionService;
  let resolver: jest.Mocked<ResolveBudgetSuggestionService>;
  let budgetRepository: jest.Mocked<BudgetRepository>;
  let cache: InMemoryCacheProvider;

  beforeEach(() => {
    resolver = {
      execute: jest
        .fn()
        .mockResolvedValue(right(makeSuggestion(makePendingIncome()))),
    } as unknown as jest.Mocked<ResolveBudgetSuggestionService>;
    budgetRepository = {
      saveSnapshotWithDecision: jest.fn().mockResolvedValue('applied'),
    } as unknown as jest.Mocked<BudgetRepository>;
    cache = new InMemoryCacheProvider();
    service = new AcceptIncomeSuggestionService(
      resolver,
      budgetRepository,
      cache,
    );
  });

  const accept = (fingerprint = FINGERPRINT) =>
    service.execute({ workspaceId: WORKSPACE_ID, fingerprint });

  const givenOutcome = (outcome: SuggestionWriteOutcome) =>
    budgetRepository.saveSnapshotWithDecision.mockResolvedValue(outcome);

  const givenIncome = (income: IncomeSuggestion) =>
    resolver.execute.mockResolvedValue(right(makeSuggestion(income)));

  it('writes the suggested income as a number with the accepted decision', async () => {
    const result = await accept();

    const expected: Omit<SaveSnapshotWithDecisionInput, 'isStillCurrent'> = {
      workspaceId: WORKSPACE_ID,
      effectiveFrom: MONTH_START,
      expectedMonthlyIncome: null,
      decision: {
        workspaceId: WORKSPACE_ID,
        kind: 'income',
        month: '2026-11',
        decision: 'accepted',
        incomeCents: 500_000,
        bracketVersion: null,
      },
      write: { kind: 'income', monthlyIncome: 500_000 },
    };
    expect(budgetRepository.saveSnapshotWithDecision).toHaveBeenCalledWith({
      ...expected,
      isStillCurrent: expect.any(Function),
    });
    expect(result.value).toEqual({
      kind: 'income',
      status: 'accepted',
      month: '2026-11',
    });
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

  it('is a no-op when the income was already accepted', async () => {
    givenIncome({ status: 'accepted' });

    const result = await accept();

    expect(result.isRight()).toBe(true);
    expect(budgetRepository.saveSnapshotWithDecision).not.toHaveBeenCalled();
  });

  it.each(['rejected', 'set', 'unavailable'] as const)(
    'refuses when the income is %s',
    async (status) => {
      givenIncome({ status });

      const result = await accept();

      expect(result.value).toBeInstanceOf(BudgetSuggestionUnavailableError);
      expect(budgetRepository.saveSnapshotWithDecision).not.toHaveBeenCalled();
    },
  );

  const freshnessCheck = (): (() => Promise<boolean>) =>
    budgetRepository.saveSnapshotWithDecision.mock.calls[0][0].isStillCurrent;

  it('confirms freshness when the recomputed suggestion has the same fingerprint', async () => {
    await accept();

    expect(await freshnessCheck()()).toBe(true);
  });

  it('denies freshness when the recomputed fingerprint differs', async () => {
    await accept();
    givenIncome(makePendingIncome({ fingerprint: 'other' }));

    expect(await freshnessCheck()()).toBe(false);
  });

  it('denies freshness when the income is no longer pending', async () => {
    await accept();
    givenIncome({ status: 'set' });

    expect(await freshnessCheck()()).toBe(false);
  });

  it('reports a change when the snapshot income drifted', async () => {
    givenOutcome('drifted');

    const result = await accept();

    expect(result.value).toBeInstanceOf(BudgetSuggestionChangedError);
  });

  it('succeeds when a concurrent request accepted first', async () => {
    givenOutcome('already-decided');
    resolver.execute
      .mockResolvedValueOnce(right(makeSuggestion(makePendingIncome())))
      .mockResolvedValueOnce(right(makeSuggestion({ status: 'accepted' })));

    const result = await accept();

    expect(result.isRight()).toBe(true);
  });

  it('refuses when a concurrent request decided differently', async () => {
    givenOutcome('already-decided');
    resolver.execute
      .mockResolvedValueOnce(right(makeSuggestion(makePendingIncome())))
      .mockResolvedValueOnce(right(makeSuggestion({ status: 'rejected' })));

    const result = await accept();

    expect(result.value).toBeInstanceOf(BudgetSuggestionUnavailableError);
  });
});
