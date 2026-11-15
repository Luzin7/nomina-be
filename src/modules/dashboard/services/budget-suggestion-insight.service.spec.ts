import {
  ResolveBudgetSuggestionService,
  type BudgetSuggestion,
  type IncomeSuggestion,
  type SplitSuggestionState,
} from '@modules/budget/services/resolve-budget-suggestion.service';
import { Logger } from '@nestjs/common';
import { left, right } from '@shared/core/errors/Either';
import { BudgetSuggestionInsightService } from './budget-suggestion-insight.service';

const PENDING_INCOME: IncomeSuggestion = {
  status: 'pending',
  incomeCents: 500_000,
  base: 'median',
  incomeMonths: 3,
  zeroIncomeMonths: 0,
  fingerprint: 'income',
};

const PENDING_SPLIT: SplitSuggestionState = {
  status: 'pending',
  step: 1,
  steps: 6,
  incomeBasisCents: null,
  bracket: null,
  allocations: [],
  unmappedCategoryIds: [],
  fingerprint: 'split',
};

const makeSuggestion = (
  overrides: Partial<BudgetSuggestion> = {},
): BudgetSuggestion => ({
  month: '2026-11',
  monthStart: new Date('2026-11-01T03:00:00.000Z'),
  basisMonths: 3,
  income: { status: 'set' },
  split: { status: 'unavailable' },
  ...overrides,
});

describe('BudgetSuggestionInsightService', () => {
  let service: BudgetSuggestionInsightService;
  let resolver: jest.Mocked<ResolveBudgetSuggestionService>;
  let warn: jest.SpyInstance;

  beforeEach(() => {
    jest.useFakeTimers();
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    resolver = {
      execute: jest.fn().mockResolvedValue(right(makeSuggestion())),
    } as unknown as jest.Mocked<ResolveBudgetSuggestionService>;
    service = new BudgetSuggestionInsightService(resolver);
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  const run = () => service.execute({ workspaceId: 'ws-1' });

  it('returns nothing when no suggestion is pending', async () => {
    expect(await run()).toBeNull();
  });

  it('points at the income suggestion when it is pending', async () => {
    resolver.execute.mockResolvedValue(
      right(makeSuggestion({ income: PENDING_INCOME })),
    );

    expect(await run()).toEqual({
      code: 'BUDGET_SUGGESTION_READY',
      severity: 'low',
      args: { kind: 'income' },
      href: '/budget',
    });
  });

  it('points at the split suggestion when only it is pending', async () => {
    resolver.execute.mockResolvedValue(
      right(makeSuggestion({ split: PENDING_SPLIT })),
    );

    expect(await run()).toMatchObject({ args: { kind: 'split' } });
  });

  it('swallows a resolver failure and logs it', async () => {
    resolver.execute.mockResolvedValue(left(new Error('boom')));

    expect(await run()).toBeNull();
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('budget-suggestion insight skipped'),
    );
  });

  it('logs the error class and message', async () => {
    resolver.execute.mockResolvedValue(left(new TypeError('pool starved')));

    await run();

    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('TypeError: pool starved'),
    );
  });

  it('waits for a slow resolver instead of timing out', async () => {
    resolver.execute.mockReturnValue(
      new Promise((resolve) =>
        setTimeout(
          () => resolve(right(makeSuggestion({ income: PENDING_INCOME }))),
          1_000,
        ),
      ),
    );

    const pending = run();
    await jest.advanceTimersByTimeAsync(1_000);

    expect(await pending).toMatchObject({ args: { kind: 'income' } });
  });
});
