import { AccountRepository } from '@modules/account/repositories/contracts/AccountRepository';
import { makeCreditCard } from '@modules/account/test-helpers/mock-factories';
import { BudgetPresenter } from '@modules/budget/presenters/Budget.presenter';
import {
  BudgetSnapshot,
  BudgetRepository,
} from '@modules/budget/repositories/contracts/BudgetRepository';
import { SaveCardCycleBudgetService } from '@modules/card-cycle/features/save-card-cycle-budget/save-card-cycle-budget.handler';
import { CardCycleRepository } from '@modules/card-cycle/repositories/contracts/CardCycleRepository';
import { FindMonthSummaryService } from '@modules/report/features/get-month-summary/get-month-summary.service';
import { MonthProjection } from '@modules/report/valueObjects/MonthProjection';
import { MonthSummary } from '@modules/report/valueObjects/MonthSummary';
import { GetWorkspaceTimezoneService } from '@modules/workspace/services/get-workspace-timezone.service';
import { DayJsDateProvider } from '@providers/date/implementations/Dayjs';
import { right } from '@shared/core/errors/Either';
import { GetBudgetStatusService } from './get-status.handler';

const TIMEZONE = 'America/Sao_Paulo';
const NOW = new Date('2026-11-15T12:00:00.000Z');
const NOVEMBER_START = new Date('2026-11-01T03:00:00.000Z');
const SEPTEMBER_START = new Date('2026-09-01T03:00:00.000Z');

const PROJECTION: MonthProjection = {
  expectedIncome: 100_000,
  expectedExpense: 60_000,
  expectedBalance: 40_000,
  realized: { totalIncome: 50_000, totalExpense: 20_000 },
  scheduled: { totalIncome: 0, totalExpense: 0 },
  recurringNotYetGenerated: { totalIncome: 0, totalExpense: 0 },
  fixedBillsDue: 5_000,
  accountedExpense: 20_000,
  variableRemaining: 10_000,
  paceDaily: 1_000,
  paceRemaining: 10_000,
  paceBalance: 5_000,
  daysRemaining: 10,
  usualExpense: 55_000,
  basisMonths: 3,
  hasHistory: true,
};

function makeSnapshot(overrides: Partial<BudgetSnapshot> = {}): BudgetSnapshot {
  return {
    id: 'budget-1',
    workspaceId: 'ws-1',
    effectiveFrom: NOVEMBER_START,
    monthlyIncome: 100_000,
    mode: 'percentage',
    allocations: [
      {
        id: 'allocation-1',
        categoryId: 'cat-1',
        categoryName: 'Moradia',
        groupName: 'Custos fixos',
        groupOrder: 0,
        categoryOrder: 0,
        percentageOfIncome: 60,
        targetCents: 60_000,
      },
      {
        id: 'allocation-2',
        categoryId: 'cat-2',
        categoryName: 'Lazer',
        groupName: 'Conforto',
        groupOrder: 1,
        categoryOrder: 0,
        percentageOfIncome: 40,
        targetCents: 40_000,
      },
    ],
    ...overrides,
  };
}

function makeSummary(): MonthSummary {
  return MonthSummary.create({
    month: NOVEMBER_START,
    totalIncome: 50_000,
    totalExpense: 20_000,
    totalCheckingBalance: 0,
    totalInvestmentBalance: 0,
    totalCreditCardBalance: 0,
    rate: { currentMonthSaving: 0, previousMonthCompareSaving: 0 },
    previousMonthToDate: { totalIncome: 0, totalExpense: 0 },
    projection: PROJECTION,
  });
}

describe('GetBudgetStatusService', () => {
  let service: GetBudgetStatusService;
  let repository: jest.Mocked<BudgetRepository>;
  let findMonthSummary: jest.Mocked<FindMonthSummaryService>;
  let workspaceTimezone: jest.Mocked<GetWorkspaceTimezoneService>;
  let dateProvider: DayJsDateProvider;

  beforeEach(() => {
    repository = {
      resolveSnapshot: jest.fn(),
      findCategoriesByIds: jest.fn(),
      findCompletedExpenseByCategory: jest.fn().mockResolvedValue({}),
      findCategoryParentMap: jest.fn().mockResolvedValue({}),
      saveSnapshot: jest.fn(),
      findMonthlyIncomeSuggestion: jest.fn(),
      findPresetCategories: jest.fn(),
    } as unknown as jest.Mocked<BudgetRepository>;

    findMonthSummary = {
      execute: jest.fn().mockResolvedValue(right(makeSummary())),
    } as unknown as jest.Mocked<FindMonthSummaryService>;

    workspaceTimezone = {
      execute: jest.fn().mockResolvedValue(TIMEZONE),
    } as unknown as jest.Mocked<GetWorkspaceTimezoneService>;

    dateProvider = new DayJsDateProvider();
    jest.spyOn(dateProvider, 'now').mockReturnValue(NOW);

    service = new GetBudgetStatusService(
      repository,
      findMonthSummary,
      workspaceTimezone,
      dateProvider,
    );
  });

  afterEach(() => jest.clearAllMocks());

  it('returns exists false when no snapshot is at or before the month', async () => {
    repository.resolveSnapshot.mockResolvedValueOnce(null);

    const result = await service.execute({
      workspaceId: 'ws-1',
      sub: 'user-1',
      month: 10,
      year: 2026,
    });

    expect(result.isRight()).toBe(true);
    if (!result.isRight()) return;
    expect(result.value).toEqual({ exists: false });
    expect(repository.resolveSnapshot).toHaveBeenCalledWith(
      'ws-1',
      new Date('2026-10-01T03:00:00.000Z'),
    );
  });

  it('resolves the snapshot in force for the requested month', async () => {
    const snapshot = makeSnapshot({ effectiveFrom: NOVEMBER_START });
    repository.resolveSnapshot.mockImplementation(
      async (_workspaceId, monthStart) =>
        monthStart.getTime() >= snapshot.effectiveFrom.getTime()
          ? snapshot
          : null,
    );

    const before = await service.execute({
      workspaceId: 'ws-1',
      sub: 'user-1',
      month: 10,
      year: 2026,
    });
    const after = await service.execute({
      workspaceId: 'ws-1',
      sub: 'user-1',
      month: 12,
      year: 2026,
    });

    expect(before.isRight() && before.value).toEqual({ exists: false });
    expect(after.isRight() && after.value.exists).toBe(true);
  });

  it('passes the projection through unchanged', async () => {
    repository.resolveSnapshot.mockResolvedValueOnce(makeSnapshot());

    const result = await service.execute({
      workspaceId: 'ws-1',
      sub: 'user-1',
      month: 11,
      year: 2026,
    });

    expect(result.isRight()).toBe(true);
    if (!result.isRight() || !result.value.exists) return;
    expect(result.value.projection).toBe(PROJECTION);
    expect(BudgetPresenter.toStatus(result.value).projection).toEqual({
      expectedIncome: 1000,
      expectedExpense: 600,
      expectedBalance: 400,
      realized: { totalIncome: 500, totalExpense: 200 },
      scheduled: { totalIncome: 0, totalExpense: 0 },
      recurringNotYetGenerated: { totalIncome: 0, totalExpense: 0 },
      fixedBillsDue: 50,
      accountedExpense: 200,
      variableRemaining: 100,
      paceDaily: 10,
      paceRemaining: 100,
      paceBalance: 50,
      daysRemaining: 10,
      usualExpense: 550,
      basisMonths: 3,
      hasHistory: true,
    });
  });

  it('returns a null projection for a past month while keeping the month data', async () => {
    repository.resolveSnapshot.mockResolvedValueOnce(
      makeSnapshot({ effectiveFrom: SEPTEMBER_START }),
    );
    repository.findCompletedExpenseByCategory.mockResolvedValueOnce({
      'cat-1': 10_000,
      'cat-2': 20_000,
    });

    const result = await service.execute({
      workspaceId: 'ws-1',
      sub: 'user-1',
      month: 10,
      year: 2026,
    });

    expect(result.isRight()).toBe(true);
    if (!result.isRight() || !result.value.exists) return;
    expect(result.value.projection).toBeNull();
    expect(result.value.allocations).toEqual([
      {
        categoryId: 'cat-1',
        categoryName: 'Moradia',
        groupName: 'Custos fixos',
        targetCents: 60_000,
        spentCents: 10_000,
        remainingCents: 50_000,
        percentageOfIncome: 60,
        percentageUsed: 17,
      },
      {
        categoryId: 'cat-2',
        categoryName: 'Lazer',
        groupName: 'Conforto',
        targetCents: 40_000,
        spentCents: 20_000,
        remainingCents: 20_000,
        percentageOfIncome: 40,
        percentageUsed: 50,
      },
    ]);
    expect(result.value.pillars).toEqual([
      {
        groupName: 'Custos fixos',
        targetCents: 60_000,
        spentCents: 10_000,
        percentage: 60,
      },
      {
        groupName: 'Conforto',
        targetCents: 40_000,
        spentCents: 20_000,
        percentage: 40,
      },
    ]);
    expect(result.value.totalTargetCents).toBe(100_000);
    expect(result.value.totalSpent).toBe(30_000);
    expect(result.value.unallocatedSpent).toBe(0);
    expect(findMonthSummary.execute).not.toHaveBeenCalled();
  });

  it('returns a null projection for a future month', async () => {
    repository.resolveSnapshot.mockResolvedValueOnce(makeSnapshot());

    const result = await service.execute({
      workspaceId: 'ws-1',
      sub: 'user-1',
      month: 12,
      year: 2026,
    });

    expect(result.isRight()).toBe(true);
    if (!result.isRight() || !result.value.exists) return;
    expect(result.value.projection).toBeNull();
    expect(result.value.allocations).toHaveLength(2);
    expect(result.value.totalTargetCents).toBe(100_000);
    expect(result.value.totalSpent).toBe(0);
    expect(findMonthSummary.execute).not.toHaveBeenCalled();
  });

  it('computes spent, remaining and percentage used per category', async () => {
    repository.resolveSnapshot.mockResolvedValueOnce(makeSnapshot());
    repository.findCompletedExpenseByCategory.mockResolvedValueOnce({
      'cat-1': 30_000,
      'cat-2': 50_000,
      'cat-unallocated': 5_000,
    });

    const result = await service.execute({
      workspaceId: 'ws-1',
      sub: 'user-1',
      month: 11,
      year: 2026,
    });

    expect(result.isRight()).toBe(true);
    if (!result.isRight() || !result.value.exists) return;
    expect(result.value.allocations).toEqual([
      {
        categoryId: 'cat-1',
        categoryName: 'Moradia',
        groupName: 'Custos fixos',
        targetCents: 60_000,
        spentCents: 30_000,
        remainingCents: 30_000,
        percentageOfIncome: 60,
        percentageUsed: 50,
      },
      {
        categoryId: 'cat-2',
        categoryName: 'Lazer',
        groupName: 'Conforto',
        targetCents: 40_000,
        spentCents: 50_000,
        remainingCents: -10_000,
        percentageOfIncome: 40,
        percentageUsed: 125,
      },
    ]);
    expect(result.value.unallocatedSpent).toBe(5_000);
    expect(result.value.totalTargetCents).toBe(100_000);
    expect(result.value.totalSpent).toBe(85_000);
    expect(result.value.pillars).toEqual([
      {
        groupName: 'Custos fixos',
        targetCents: 60_000,
        spentCents: 30_000,
        percentage: 60,
      },
      {
        groupName: 'Conforto',
        targetCents: 40_000,
        spentCents: 50_000,
        percentage: 40,
      },
    ]);
  });

  it('rolls a child transaction up to its allocated parent', async () => {
    repository.resolveSnapshot.mockResolvedValueOnce(makeSnapshot());
    repository.findCompletedExpenseByCategory.mockResolvedValueOnce({
      'cat-aluguel': 15_000,
    });
    repository.findCategoryParentMap.mockResolvedValueOnce({
      'cat-1': null,
      'cat-aluguel': 'cat-1',
    });

    const result = await service.execute({
      workspaceId: 'ws-1',
      sub: 'user-1',
      month: 11,
      year: 2026,
    });

    expect(result.isRight()).toBe(true);
    if (!result.isRight() || !result.value.exists) return;
    expect(result.value.allocations[0]).toMatchObject({
      categoryId: 'cat-1',
      spentCents: 15_000,
      remainingCents: 45_000,
      percentageUsed: 25,
    });
    expect(result.value.unallocatedSpent).toBe(0);
    expect(result.value.totalSpent).toBe(15_000);
    expect(result.value.pillars[0]).toMatchObject({
      groupName: 'Custos fixos',
      spentCents: 15_000,
    });
  });

  it('adds sibling child transactions under the allocated parent', async () => {
    repository.resolveSnapshot.mockResolvedValueOnce(makeSnapshot());
    repository.findCompletedExpenseByCategory.mockResolvedValueOnce({
      'cat-aluguel': 10_000,
      'cat-internet': 5_000,
    });
    repository.findCategoryParentMap.mockResolvedValueOnce({
      'cat-1': null,
      'cat-aluguel': 'cat-1',
      'cat-internet': 'cat-1',
    });

    const result = await service.execute({
      workspaceId: 'ws-1',
      sub: 'user-1',
      month: 11,
      year: 2026,
    });

    expect(result.isRight()).toBe(true);
    if (!result.isRight() || !result.value.exists) return;
    expect(result.value.allocations[0].spentCents).toBe(15_000);
    expect(result.value.unallocatedSpent).toBe(0);
  });

  it('keeps a child of an unallocated parent as unallocated spend', async () => {
    repository.resolveSnapshot.mockResolvedValueOnce(makeSnapshot());
    repository.findCompletedExpenseByCategory.mockResolvedValueOnce({
      'cat-cinema': 5_000,
    });
    repository.findCategoryParentMap.mockResolvedValueOnce({
      'cat-lazer': null,
      'cat-cinema': 'cat-lazer',
    });

    const result = await service.execute({
      workspaceId: 'ws-1',
      sub: 'user-1',
      month: 11,
      year: 2026,
    });

    expect(result.isRight()).toBe(true);
    if (!result.isRight() || !result.value.exists) return;
    expect(result.value.allocations[1].spentCents).toBe(0);
    expect(result.value.unallocatedSpent).toBe(5_000);
  });

  it('attributes spend to the nearest allocated category without double counting', async () => {
    repository.resolveSnapshot.mockResolvedValueOnce(
      makeSnapshot({
        allocations: [
          ...makeSnapshot().allocations,
          {
            id: 'allocation-3',
            categoryId: 'cat-aluguel',
            categoryName: 'Aluguel',
            groupName: 'Custos fixos',
            groupOrder: 0,
            categoryOrder: 1,
            percentageOfIncome: 0,
            targetCents: 20_000,
          },
        ],
      }),
    );
    repository.findCompletedExpenseByCategory.mockResolvedValueOnce({
      'cat-aluguel': 10_000,
    });
    repository.findCategoryParentMap.mockResolvedValueOnce({
      'cat-1': null,
      'cat-aluguel': 'cat-1',
    });

    const result = await service.execute({
      workspaceId: 'ws-1',
      sub: 'user-1',
      month: 11,
      year: 2026,
    });

    expect(result.isRight()).toBe(true);
    if (!result.isRight() || !result.value.exists) return;
    expect(result.value.allocations[0].spentCents).toBe(0);
    expect(result.value.allocations[2].spentCents).toBe(10_000);
    expect(result.value.unallocatedSpent).toBe(0);
    expect(result.value.totalSpent).toBe(10_000);
  });

  it('keeps a budgeted category with zero spend at 0% used', async () => {
    repository.resolveSnapshot.mockResolvedValueOnce(makeSnapshot());

    const result = await service.execute({
      workspaceId: 'ws-1',
      sub: 'user-1',
      month: 11,
      year: 2026,
    });

    expect(result.isRight()).toBe(true);
    if (!result.isRight() || !result.value.exists) return;
    expect(result.value.allocations[0]).toMatchObject({
      spentCents: 0,
      remainingCents: 60_000,
      percentageUsed: 0,
    });
  });

  it('hides allocations whose category no longer exists', async () => {
    repository.resolveSnapshot.mockResolvedValueOnce(
      makeSnapshot({
        allocations: [
          ...makeSnapshot().allocations,
          {
            id: 'allocation-3',
            categoryId: 'cat-deleted',
            categoryName: null,
            groupName: 'Conforto',
            groupOrder: 1,
            categoryOrder: 1,
            percentageOfIncome: 0,
            targetCents: 0,
          },
        ],
      }),
    );

    const result = await service.execute({
      workspaceId: 'ws-1',
      sub: 'user-1',
      month: 11,
      year: 2026,
    });

    expect(result.isRight()).toBe(true);
    if (!result.isRight() || !result.value.exists) return;
    expect(result.value.allocations).toHaveLength(2);
    expect(
      result.value.allocations.some(
        (allocation) => allocation.categoryId === 'cat-deleted',
      ),
    ).toBe(false);
  });

  it('reports the declared income and the summed plan separately in fixed mode', async () => {
    repository.resolveSnapshot.mockResolvedValueOnce(
      makeSnapshot({
        mode: 'fixed',
        monthlyIncome: 100_000,
        allocations: [
          {
            id: 'allocation-1',
            categoryId: 'cat-1',
            categoryName: 'Moradia',
            groupName: 'Custos fixos',
            groupOrder: 0,
            categoryOrder: 0,
            percentageOfIncome: 60,
            targetCents: 60_000,
          },
          {
            id: 'allocation-2',
            categoryId: 'cat-2',
            categoryName: 'Lazer',
            groupName: 'Conforto',
            groupOrder: 1,
            categoryOrder: 0,
            percentageOfIncome: 20,
            targetCents: 20_000,
          },
        ],
      }),
    );

    const result = await service.execute({
      workspaceId: 'ws-1',
      sub: 'user-1',
      month: 11,
      year: 2026,
    });

    expect(result.isRight()).toBe(true);
    if (!result.isRight() || !result.value.exists) return;
    expect(result.value.mode).toBe('fixed');
    expect(result.value.monthlyIncomeCents).toBe(100_000);
    expect(result.value.totalTargetCents).toBe(80_000);
    expect(result.value.monthlyIncomeCents).not.toBe(
      result.value.totalTargetCents,
    );
    expect(result.value.unallocatedIncomeCents).toBe(20_000);
    expect(result.value.allocationState).toBe('under');
    expect(
      result.value.allocations.map(
        (allocation) => allocation.percentageOfIncome,
      ),
    ).toEqual([60, 20]);
  });

  it('clamps unallocated income at zero and flags an over plan', async () => {
    repository.resolveSnapshot.mockResolvedValueOnce(
      makeSnapshot({
        mode: 'fixed',
        monthlyIncome: 100_000,
        allocations: [
          {
            id: 'allocation-1',
            categoryId: 'cat-1',
            categoryName: 'Moradia',
            groupName: 'Custos fixos',
            groupOrder: 0,
            categoryOrder: 0,
            percentageOfIncome: 60,
            targetCents: 60_000,
          },
          {
            id: 'allocation-2',
            categoryId: 'cat-2',
            categoryName: 'Lazer',
            groupName: 'Conforto',
            groupOrder: 1,
            categoryOrder: 0,
            percentageOfIncome: 50,
            targetCents: 50_000,
          },
        ],
      }),
    );

    const result = await service.execute({
      workspaceId: 'ws-1',
      sub: 'user-1',
      month: 11,
      year: 2026,
    });

    expect(result.isRight()).toBe(true);
    if (!result.isRight() || !result.value.exists) return;
    expect(result.value.monthlyIncomeCents).toBe(100_000);
    expect(result.value.totalTargetCents).toBe(110_000);
    expect(result.value.unallocatedIncomeCents).toBe(0);
    expect(result.value.allocationState).toBe('over');
  });

  it('is balanced when the plan equals the declared income', async () => {
    repository.resolveSnapshot.mockResolvedValueOnce(makeSnapshot());

    const result = await service.execute({
      workspaceId: 'ws-1',
      sub: 'user-1',
      month: 11,
      year: 2026,
    });

    expect(result.isRight()).toBe(true);
    if (!result.isRight() || !result.value.exists) return;
    expect(result.value.mode).toBe('percentage');
    expect(result.value.unallocatedIncomeCents).toBe(0);
    expect(result.value.allocationState).toBe('balanced');
  });

  it('sums the plan before dropping allocations whose category is gone', async () => {
    repository.resolveSnapshot.mockResolvedValueOnce(
      makeSnapshot({
        mode: 'fixed',
        monthlyIncome: 100_000,
        allocations: [
          ...makeSnapshot().allocations,
          {
            id: 'allocation-3',
            categoryId: 'cat-deleted',
            categoryName: null,
            groupName: 'Conforto',
            groupOrder: 1,
            categoryOrder: 1,
            percentageOfIncome: 25,
            targetCents: 25_000,
          },
        ],
      }),
    );

    const result = await service.execute({
      workspaceId: 'ws-1',
      sub: 'user-1',
      month: 11,
      year: 2026,
    });

    expect(result.isRight()).toBe(true);
    if (!result.isRight() || !result.value.exists) return;
    expect(result.value.allocations).toHaveLength(2);
    expect(result.value.totalTargetCents).toBe(125_000);
    expect(result.value.allocationState).toBe('over');
  });

  it('keeps every budget figure unchanged after a card cycle limit is saved', async () => {
    repository.resolveSnapshot.mockResolvedValue(makeSnapshot());
    repository.findCompletedExpenseByCategory.mockResolvedValue({
      'cat-1': 10_000,
    });

    const before = await service.execute({
      workspaceId: 'ws-1',
      sub: 'user-1',
      month: 11,
      year: 2026,
    });

    const saveCardCycleBudget = new SaveCardCycleBudgetService(
      {
        findById: jest.fn().mockResolvedValue(makeCreditCard()),
      } as unknown as jest.Mocked<AccountRepository>,
      {
        materializePeriod: jest.fn(),
        findPeriod: jest.fn(),
        findApplicableBudget: jest.fn(),
        saveBudget: jest.fn().mockResolvedValue({
          id: 'card-cycle-budget-1',
          workspaceId: 'ws-1',
          accountId: 'acc-1',
          effectiveFrom: '2026-12-15',
          limitCents: 250_000,
        }),
        listPeriods: jest.fn(),
        sumCycleSpend: jest.fn(),
      } as unknown as jest.Mocked<CardCycleRepository>,
      dateProvider,
    );
    const saved = await saveCardCycleBudget.execute({
      workspaceId: 'ws-1',
      accountId: 'acc-1',
      effectiveFrom: '2026-12-15',
      limitCents: 250_000,
    });

    const after = await service.execute({
      workspaceId: 'ws-1',
      sub: 'user-1',
      month: 11,
      year: 2026,
    });

    expect(saved.isRight()).toBe(true);
    expect(after.isRight() && after.value).toMatchObject({
      exists: true,
      totalTargetCents: 100_000,
      totalSpent: 10_000,
      unallocatedSpent: 0,
      allocationState: 'balanced',
      allocations: [
        { categoryId: 'cat-1', spentCents: 10_000, remainingCents: 50_000 },
        { categoryId: 'cat-2', spentCents: 0, remainingCents: 40_000 },
      ],
    });
    expect(after.isRight() && after.value).toEqual(
      before.isRight() && before.value,
    );
  });
});
