import { toHTTPProjection } from '@modules/report/presenters/MonthProjection.presenter';
import { MonthSummaryPresenter } from '@modules/report/presenters/MonthlySummary.presenter';
import { MonthProjection } from '@modules/report/valueObjects/MonthProjection';
import { MonthSummary } from '@modules/report/valueObjects/MonthSummary';
import { BudgetStatusResponse } from '../features/get-status/get-status.handler';
import { BudgetPresenter } from './Budget.presenter';

const PROJECTION: MonthProjection = {
  expectedIncome: 850_000,
  expectedExpense: 392_216,
  expectedBalance: 457_784,
  realized: { totalIncome: 850_000, totalExpense: 231_015 },
  scheduled: { totalIncome: 0, totalExpense: 118_000 },
  recurringNotYetGenerated: { totalIncome: 0, totalExpense: 38_990 },
  fixedBillsDue: 0,
  accountedExpense: 388_005,
  variableRemaining: 4_211,
  paceDaily: 526,
  paceRemaining: 1_100,
  paceBalance: 2_000,
  daysRemaining: 8,
  usualExpense: 510_040,
  basisMonths: 3,
  hasHistory: true,
};

function makeStatus(projection: MonthProjection | null): BudgetStatusResponse {
  return {
    exists: true,
    mode: 'percentage',
    monthlyIncomeCents: 850_000,
    effectiveFrom: new Date('2026-11-01T03:00:00.000Z'),
    allocations: [
      {
        categoryId: 'cat-1',
        categoryName: 'Moradia',
        groupName: 'Custos fixos',
        targetCents: 500_000,
        spentCents: 200_000,
        remainingCents: 300_000,
        percentageOfIncome: 59,
        percentageUsed: 40,
      },
    ],
    pillars: [
      {
        groupName: 'Custos fixos',
        targetCents: 500_000,
        spentCents: 200_000,
        percentage: 40,
      },
    ],
    unallocatedSpent: 0,
    totalTargetCents: 850_000,
    unallocatedIncomeCents: 0,
    allocationState: 'balanced',
    totalSpent: 200_000,
    projection,
  };
}

function makeSummary(projection: MonthProjection): MonthSummary {
  return MonthSummary.create({
    month: new Date('2026-11-01T03:00:00.000Z'),
    totalIncome: 850_000,
    totalExpense: 231_015,
    totalCheckingBalance: 0,
    totalInvestmentBalance: 0,
    totalCreditCardBalance: 0,
    rate: { currentMonthSaving: 0, previousMonthCompareSaving: 0 },
    previousMonthToDate: { totalIncome: 0, totalExpense: 0 },
    projection,
  });
}

describe('BudgetPresenter', () => {
  it('converts the projection to the same decimals as the report', () => {
    const { projection } = BudgetPresenter.toStatus(makeStatus(PROJECTION));

    expect(projection).toEqual(toHTTPProjection(PROJECTION));
    expect(projection).toEqual(
      MonthSummaryPresenter.toHTTP(makeSummary(PROJECTION)).projection,
    );
    expect(projection?.expectedIncome).toBe(8500);
  });

  it('keeps a null projection null', () => {
    expect(BudgetPresenter.toStatus(makeStatus(null)).projection).toBeNull();
  });

  it('exposes the declared income and the plan as separate fields', () => {
    const status = BudgetPresenter.toStatus(makeStatus(null));

    expect(status).toMatchObject({
      mode: 'percentage',
      monthlyIncomeCents: 850_000,
      totalTargetCents: 850_000,
      unallocatedIncomeCents: 0,
      allocationState: 'balanced',
    });
    if (!status.exists) return;
    expect(status.allocations[0].percentageOfIncome).toBe(59);
    expect('monthlyIncome' in status).toBe(false);
    expect('totalTarget' in status).toBe(false);
  });

  it('keeps a null income and null percentages null', () => {
    const base = makeStatus(null);
    if (!base.exists) return;
    const status = BudgetPresenter.toStatus({
      ...base,
      monthlyIncomeCents: null,
      allocations: [{ ...base.allocations[0], percentageOfIncome: null }],
      pillars: [{ ...base.pillars[0], percentage: null }],
    });

    if (!status.exists) return;
    expect(status.monthlyIncomeCents).toBeNull();
    expect(status.allocations[0].percentageOfIncome).toBeNull();
    expect(status.pillars[0].percentage).toBeNull();
  });

  it('returns the saved config without echoing the allocations', () => {
    const config = BudgetPresenter.toConfig({
      id: 'budget-1',
      effectiveFrom: new Date('2026-12-01T03:00:00.000Z'),
      mode: 'fixed',
      monthlyIncomeCents: 100_000,
      totalTargetCents: 80_500,
      unallocatedIncomeCents: 19_500,
      allocationState: 'under',
    });

    expect(config).toEqual({
      id: 'budget-1',
      effectiveFrom: new Date('2026-12-01T03:00:00.000Z'),
      mode: 'fixed',
      monthlyIncomeCents: 100_000,
      totalTargetCents: 80_500,
      unallocatedIncomeCents: 19_500,
      allocationState: 'under',
    });
  });
});
