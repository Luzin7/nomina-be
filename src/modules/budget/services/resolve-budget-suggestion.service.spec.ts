import { BudgetSuggestionParametersInvalidError } from '@modules/budget/errors';
import {
  BudgetRepository,
  type BudgetSnapshot,
  type InferenceMonthTotals,
  type SuggestionParameters,
} from '@modules/budget/repositories/contracts/BudgetRepository';
import { toAllocationInputs } from '@modules/budget/valueObjects/SplitAllocationLayout';
import { type SuggestionDecisionRecord } from '@modules/budget/valueObjects/SuggestionDecisions';
import { MonthProjectionRepository } from '@modules/report/repositories/contracts/MonthProjectionRepository';
import { type LedgerMonth } from '@modules/report/valueObjects/MonthProjection';
import { GetWorkspaceTimezoneService } from '@modules/workspace/services/get-workspace-timezone.service';
import { CacheProvider } from '@infra/cache/contracts/CacheProvider';
import { Logger } from '@nestjs/common';
import { captureException } from '@sentry/nestjs';
import {
  LEDGER_LIVE_CACHE_TTL_SECONDS,
  ledgerGenerationKey,
} from '@shared/cache/report-cache';
import { SingleFlight } from '@shared/cache/single-flight';
import { InMemoryCacheProvider } from '@shared/cache/test-helpers/in-memory-cache';
import { DayJsDateProvider } from '@providers/date/implementations/Dayjs';
import {
  ResolveBudgetSuggestionService,
  type BudgetSuggestion,
} from './resolve-budget-suggestion.service';

jest.mock('@sentry/nestjs', () => ({ captureException: jest.fn() }));

const WORKSPACE_ID = 'ws-1';
const SAO_PAULO = 'America/Sao_Paulo';
const NOW = new Date('2026-11-15T15:00:00.000Z');
const ESSENTIALS_ID = 'cat-essentials';
const LEISURE_ID = 'cat-leisure';

const makeActiveMonth = (
  key: string,
  overrides: Partial<LedgerMonth> = {},
): LedgerMonth => ({
  key,
  totalIncome: 0,
  totalExpense: 0,
  pending: { totalIncome: 0, totalExpense: 0 },
  completedCount: 0,
  plainExpenses: [1, 2, 3, 4, 5].map((day) => ({
    day,
    categoryId: ESSENTIALS_ID,
    amount: 100,
    pending: false,
  })),
  ...overrides,
});

const makeTotals = (
  month: string,
  overrides: Partial<InferenceMonthTotals> = {},
): InferenceMonthTotals => ({
  month,
  incomeCents: 500_000,
  expenseByCategory: { [ESSENTIALS_ID]: 200_000, [LEISURE_ID]: 100_000 },
  ...overrides,
});

const makeParameters = (
  overrides: Partial<SuggestionParameters> = {},
): SuggestionParameters => ({
  minimumWage: { valueCents: 162_100, effectiveFrom: '2026-01-01' },
  bracketVersion: 1,
  bracketRows: [
    {
      position: 1,
      maxMinimumWages: '5.00',
      essentialsBp: 6000,
      lifestyleBp: 3000,
      savingsBp: 1000,
    },
    {
      position: 2,
      maxMinimumWages: null,
      essentialsBp: 5000,
      lifestyleBp: 3000,
      savingsBp: 2000,
    },
  ],
  groupByCategoryName: { Moradia: 'essentials', Lazer: 'lifestyle' },
  ...overrides,
});

const makeSnapshot = (monthlyIncome: number | null): BudgetSnapshot => ({
  id: 'snapshot-1',
  workspaceId: WORKSPACE_ID,
  effectiveFrom: new Date('2026-11-01T03:00:00.000Z'),
  monthlyIncome,
  mode: 'fixed',
  allocations: [],
});

const makeDecision = (
  overrides: Partial<SuggestionDecisionRecord> = {},
): SuggestionDecisionRecord => ({
  kind: 'income',
  month: '2026-11',
  decision: 'accepted',
  incomeCents: 500_000,
  bracketVersion: null,
  ...overrides,
});

describe('ResolveBudgetSuggestionService', () => {
  let service: ResolveBudgetSuggestionService;
  let budgetRepository: jest.Mocked<BudgetRepository>;
  let monthProjectionRepository: jest.Mocked<MonthProjectionRepository>;
  let dateProvider: DayJsDateProvider;
  let cache: jest.Mocked<CacheProvider>;

  beforeEach(() => {
    budgetRepository = {
      resolveSnapshot: jest.fn().mockResolvedValue(null),
      findInferenceTotals: jest
        .fn()
        .mockResolvedValue([
          makeTotals('2026-08'),
          makeTotals('2026-09'),
          makeTotals('2026-10'),
        ]),
      findSuggestionCategories: jest.fn().mockResolvedValue([
        { id: ESSENTIALS_ID, name: 'Moradia', parentId: null, hidden: false },
        { id: LEISURE_ID, name: 'Lazer', parentId: null, hidden: false },
      ]),
      findSuggestionParameters: jest.fn().mockResolvedValue(makeParameters()),
      findSuggestionDecisions: jest.fn().mockResolvedValue([]),
    } as unknown as jest.Mocked<BudgetRepository>;
    monthProjectionRepository = {
      findMonthLedger: jest
        .fn()
        .mockResolvedValue([
          makeActiveMonth('2026-08'),
          makeActiveMonth('2026-09'),
          makeActiveMonth('2026-10'),
        ]),
    } as unknown as jest.Mocked<MonthProjectionRepository>;
    cache = {
      get: jest.fn().mockResolvedValue(null),
      set: jest.fn().mockResolvedValue(true),
      readCounter: jest.fn().mockResolvedValue(7),
    } as unknown as jest.Mocked<CacheProvider>;
    dateProvider = new DayJsDateProvider();
    jest.spyOn(dateProvider, 'now').mockReturnValue(NOW);

    service = new ResolveBudgetSuggestionService(
      budgetRepository,
      monthProjectionRepository,
      {
        execute: jest.fn().mockResolvedValue(SAO_PAULO),
      } as unknown as GetWorkspaceTimezoneService,
      dateProvider,
      cache,
      new SingleFlight(),
    );
  });

  afterEach(() => jest.restoreAllMocks());

  const resolve = async (): Promise<BudgetSuggestion> => {
    const result = await service.execute({ workspaceId: WORKSPACE_ID });
    if (result.isLeft()) throw result.value;
    return result.value;
  };

  it('suggests the median income from the basis months', async () => {
    const { income, basisMonths, month } = await resolve();

    expect(month).toBe('2026-11');
    expect(basisMonths).toBe(3);
    expect(income).toMatchObject({
      status: 'pending',
      incomeCents: 500_000,
      incomeMonths: 3,
      zeroIncomeMonths: 0,
    });
    expect(income).not.toHaveProperty('base');
  });

  it('anchors the month start in the workspace timezone', async () => {
    const { monthStart } = await resolve();

    expect(monthStart).toEqual(new Date('2026-11-01T03:00:00.000Z'));
  });

  it('keeps the income fingerprint stable and sensitive to the income', async () => {
    const first = await resolve();
    const second = await resolve();
    budgetRepository.findInferenceTotals.mockResolvedValue([
      makeTotals('2026-08', { incomeCents: 600_000 }),
      makeTotals('2026-09', { incomeCents: 600_000 }),
      makeTotals('2026-10', { incomeCents: 600_000 }),
    ]);
    const changed = await resolve();

    expect(first.income).toEqual(second.income);
    expect(first.income).not.toEqual(changed.income);
  });

  it('marks income unavailable and split unavailable without basis months', async () => {
    monthProjectionRepository.findMonthLedger.mockResolvedValue([]);

    const { income, split } = await resolve();

    expect(income).toEqual({ status: 'unavailable' });
    expect(split).toEqual({ status: 'unavailable' });
  });

  it('reports income as accepted after an acceptance this month', async () => {
    budgetRepository.findSuggestionDecisions.mockResolvedValue([
      makeDecision(),
    ]);

    const { income } = await resolve();

    expect(income).toEqual({ status: 'accepted' });
  });

  it('reports income as set when the snapshot already has one', async () => {
    budgetRepository.resolveSnapshot.mockResolvedValue(makeSnapshot(450_000));

    const { income } = await resolve();

    expect(income).toEqual({ status: 'set' });
  });

  it('builds the split on the snapshot income with the resolved bracket', async () => {
    budgetRepository.resolveSnapshot.mockResolvedValue(makeSnapshot(500_000));

    const { split } = await resolve();

    expect(split).toMatchObject({
      status: 'pending',
      step: 1,
      steps: 6,
      incomeBasisCents: 500_000,
      bracket: { position: 1, version: 1 },
      unmappedCategoryIds: [],
    });
  });

  it('builds the split from actual spend when no income is set', async () => {
    const { split } = await resolve();

    expect(split).toMatchObject({
      status: 'pending',
      incomeBasisCents: null,
      bracket: null,
    });
  });

  it('keeps the split fingerprint sensitive to the allocations', async () => {
    const first = await resolve();
    budgetRepository.findInferenceTotals.mockResolvedValue([
      makeTotals('2026-08', { expenseByCategory: { [ESSENTIALS_ID]: 1 } }),
      makeTotals('2026-09', { expenseByCategory: { [ESSENTIALS_ID]: 1 } }),
      makeTotals('2026-10', { expenseByCategory: { [ESSENTIALS_ID]: 1 } }),
    ]);
    const changed = await resolve();

    expect(first.split).not.toEqual(changed.split);
  });

  it('logs and drops the bracket when the minimum wage is missing', async () => {
    const error = jest.spyOn(Logger.prototype, 'error').mockImplementation();
    budgetRepository.findSuggestionParameters.mockResolvedValue(
      makeParameters({ minimumWage: null }),
    );
    budgetRepository.resolveSnapshot.mockResolvedValue(makeSnapshot(500_000));

    const { split } = await resolve();

    expect(split).toMatchObject({ status: 'pending', bracket: null });
    expect(error).toHaveBeenCalledWith(
      `budget-suggestion.parameters-invalid workspaceId=${WORKSPACE_ID}`,
    );
    expect(captureException).toHaveBeenCalledWith(
      expect.any(BudgetSuggestionParametersInvalidError),
      { extra: { workspaceId: WORKSPACE_ID } },
    );
  });

  it('warns when the minimum wage row is older than 13 months', async () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    budgetRepository.findSuggestionParameters.mockResolvedValue(
      makeParameters({
        minimumWage: { valueCents: 162_100, effectiveFrom: '2025-01-01' },
      }),
    );

    await resolve();

    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('budget-suggestion.minimum-wage-stale'),
    );
  });

  it('reports a finished split as complete', async () => {
    budgetRepository.resolveSnapshot.mockResolvedValue(makeSnapshot(500_000));
    budgetRepository.findSuggestionDecisions.mockResolvedValue([
      makeDecision({ kind: 'split', month: '2026-05', bracketVersion: 1 }),
      makeDecision({ kind: 'split', month: '2026-10', bracketVersion: 1 }),
    ]);

    const { split } = await resolve();

    expect(split).toEqual({ status: 'complete' });
  });

  describe('plan', () => {
    const planFor = async () => (await resolve()).plan;

    it('is null without basis months', async () => {
      monthProjectionRepository.findMonthLedger.mockResolvedValue([]);

      expect(await planFor()).toBeNull();
    });

    it.each([
      [['2026-10', '2026-09'], 2],
      [['2026-10', '2026-09', '2026-08'], 3],
      [
        [
          '2026-10',
          '2026-09',
          '2026-08',
          '2026-07',
          '2026-06',
          '2026-05',
          '2026-04',
          '2026-03',
        ],
        6,
      ],
    ])('is built from the latest basis months %j', async (keys, expected) => {
      monthProjectionRepository.findMonthLedger.mockResolvedValue(
        keys.map((key) => makeActiveMonth(key)),
      );
      budgetRepository.findInferenceTotals.mockResolvedValue(
        keys.map((key) => makeTotals(key)),
      );

      const plan = await planFor();

      expect(plan?.basisMonths).toBe(expected);
      expect(plan?.allocations.length).toBeGreaterThan(0);
    });

    it('totals what accepting the pending split would save', async () => {
      const { plan, split } = await resolve();
      if (split.status !== 'pending') throw new Error('split not pending');

      expect(plan?.planTotalCents).toBe(
        toAllocationInputs(split.allocations).reduce(
          (total, { targetCents }) => total + targetCents,
          0,
        ),
      );
      expect(plan?.allocations).toEqual(split.allocations);
    });

    it('is still computed when the split was rejected this month', async () => {
      budgetRepository.findSuggestionDecisions.mockResolvedValue([
        makeDecision({
          kind: 'split',
          decision: 'rejected',
          incomeCents: null,
        }),
      ]);

      const { plan, split } = await resolve();

      expect(split).toEqual({ status: 'rejected' });
      expect(plan?.basisMonths).toBe(3);
      expect(plan?.planTotalCents).toBeGreaterThan(0);
    });

    it('keeps the ideal split within the snapshot income', async () => {
      budgetRepository.resolveSnapshot.mockResolvedValue(makeSnapshot(500_000));

      const plan = await planFor();
      const idealTotal = (plan?.allocations ?? []).reduce(
        (total, { idealCents }) => total + (idealCents ?? 0),
        0,
      );

      expect(idealTotal).toBeLessThanOrEqual(500_000);
    });

    it('does not cap the step-k total at the snapshot income', async () => {
      budgetRepository.resolveSnapshot.mockResolvedValue({
        ...makeSnapshot(500_000),
        allocations: [
          {
            id: 'allocation-1',
            categoryId: ESSENTIALS_ID,
            categoryName: 'Moradia',
            groupName: 'Essenciais',
            groupOrder: 0,
            categoryOrder: 0,
            percentageOfIncome: null,
            targetCents: 600_000,
          },
        ],
      });
      budgetRepository.findSuggestionDecisions.mockResolvedValue([
        makeDecision({ kind: 'split', month: '2026-09', bracketVersion: 1 }),
      ]);

      const { plan, split } = await resolve();

      expect(split).toMatchObject({ status: 'pending', step: 3 });
      expect(plan?.planTotalCents).toBeGreaterThan(500_000);
    });

    it.each(['rejected', 'accepted'] as const)(
      'keeps the %s split status with a null plan when there are no allocations',
      async (decision) => {
        budgetRepository.findSuggestionDecisions.mockResolvedValue([
          makeDecision({ kind: 'split', decision, incomeCents: null }),
        ]);
        budgetRepository.findSuggestionCategories.mockResolvedValue([]);

        const { split, plan } = await resolve();

        expect(split).toEqual({ status: decision });
        expect(plan).toBeNull();
      },
    );

    it.each(['rejected', 'accepted'] as const)(
      'keeps the %s split status with a null plan when there are no basis months',
      async (decision) => {
        monthProjectionRepository.findMonthLedger.mockResolvedValue([]);
        budgetRepository.findSuggestionDecisions.mockResolvedValue([
          makeDecision({ kind: 'split', decision, incomeCents: null }),
        ]);

        const { split, plan } = await resolve();

        expect(split).toEqual({ status: decision });
        expect(plan).toBeNull();
      },
    );

    it('is null when no category yields an allocation', async () => {
      budgetRepository.findSuggestionCategories.mockResolvedValue([]);

      expect(await planFor()).toBeNull();
    });
  });

  describe('planEligible', () => {
    const eligibleMonths = ['2026-08', '2026-09', '2026-10'].map((key) =>
      makeActiveMonth(key, { completedCount: 1 }),
    );

    it('is true with 3 closed months that have completed transactions', async () => {
      monthProjectionRepository.findMonthLedger.mockResolvedValue(
        eligibleMonths,
      );

      expect((await resolve()).planEligible).toBe(true);
    });

    it('is false when the closed months have no completed transactions', async () => {
      expect((await resolve()).planEligible).toBe(false);
    });
  });

  describe('cache', () => {
    const buildService = (provider: CacheProvider) =>
      new ResolveBudgetSuggestionService(
        budgetRepository,
        monthProjectionRepository,
        {
          execute: jest.fn().mockResolvedValue(SAO_PAULO),
        } as unknown as GetWorkspaceTimezoneService,
        dateProvider,
        provider,
        new SingleFlight(),
      );

    it('keys by the ledger and category generations and the local day', async () => {
      cache.readCounter.mockImplementation(async (key) =>
        key.includes('report') ? 11 : 22,
      );

      await resolve();

      expect(cache.get).toHaveBeenCalledWith(
        `budget:suggestion:v4:${WORKSPACE_ID}:g11:c22:2026-11-15`,
      );
    });

    it('stores with the live ledger ttl', async () => {
      await resolve();

      expect(cache.set).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        LEDGER_LIVE_CACHE_TTL_SECONDS,
      );
    });

    it('serves the second call from the cache without loading', async () => {
      const provider = new InMemoryCacheProvider();
      const cached = buildService(provider);

      const first = await cached.execute({ workspaceId: WORKSPACE_ID });
      const second = await cached.execute({ workspaceId: WORKSPACE_ID });

      expect(second.value).toEqual(first.value);
      expect(budgetRepository.findSuggestionDecisions).toHaveBeenCalledTimes(1);
    });

    it('misses after the ledger generation changes', async () => {
      const provider = new InMemoryCacheProvider();
      const cached = buildService(provider);

      await cached.execute({ workspaceId: WORKSPACE_ID });
      await provider.incrementCounter(
        ledgerGenerationKey(WORKSPACE_ID),
        Date.now(),
      );
      await cached.execute({ workspaceId: WORKSPACE_ID });

      expect(budgetRepository.findSuggestionDecisions).toHaveBeenCalledTimes(2);
    });

    it('resolveFresh ignores a stale cached entry and never stores', async () => {
      const provider = new InMemoryCacheProvider();
      const cached = buildService(provider);
      await cached.execute({ workspaceId: WORKSPACE_ID });
      budgetRepository.findSuggestionDecisions.mockResolvedValue([
        makeDecision(),
      ]);
      const readsBefore = provider.values.size;

      const stale = await cached.execute({ workspaceId: WORKSPACE_ID });
      const fresh = await cached.resolveFresh({ workspaceId: WORKSPACE_ID });

      expect(stale.value).toMatchObject({ income: { status: 'pending' } });
      expect(fresh.value).toEqual(
        expect.objectContaining({ income: { status: 'accepted' } }),
      );
      expect(provider.values.size).toBe(readsBefore);
    });

    it('loads once for two concurrent misses', async () => {
      await Promise.all([resolve(), resolve()]);

      expect(budgetRepository.findSuggestionDecisions).toHaveBeenCalledTimes(1);
    });

    it('loads without caching when a generation is unavailable', async () => {
      cache.readCounter.mockResolvedValue(null);

      await Promise.all([resolve(), resolve()]);

      expect(cache.set).not.toHaveBeenCalled();
      expect(budgetRepository.findSuggestionDecisions).toHaveBeenCalledTimes(2);
    });
  });
});
