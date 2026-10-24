import { MonthProjection } from '@modules/report/valueObjects/MonthProjection';
import {
  MonthSummary,
  MonthSummaryType,
} from '@modules/report/valueObjects/MonthSummary';
import { MonthSummaryPresenter } from './MonthlySummary.presenter';

function makeProjection(
  overrides: Partial<MonthProjection> = {},
): MonthProjection {
  return {
    expectedIncome: 850000,
    expectedExpense: 452940,
    expectedBalance: 397060,
    realized: { totalIncome: 850000, totalExpense: 231015 },
    scheduled: { totalIncome: 0, totalExpense: 118000 },
    recurringNotYetGenerated: { totalIncome: 0, totalExpense: 38990 },
    variableEstimate: 64935,
    usualExpense: 510040,
    basisMonths: 3,
    hasHistory: true,
    ...overrides,
  };
}

function makeSummary(overrides: Partial<MonthSummaryType> = {}): MonthSummary {
  return MonthSummary.create({
    month: new Date('2026-09-01T03:00:00.000Z'),
    totalIncome: 850000,
    totalExpense: 231015,
    totalCheckingBalance: 150000,
    totalInvestmentBalance: 200000,
    totalCreditCardBalance: -30000,
    rate: { currentMonthSaving: 60, previousMonthCompareSaving: 10 },
    previousMonthToDate: { totalIncome: 1000, totalExpense: 500 },
    projection: makeProjection(),
    ...overrides,
  });
}

describe('MonthSummaryPresenter', () => {
  it('converts the projection cents to decimals', () => {
    expect(MonthSummaryPresenter.toHTTP(makeSummary()).projection).toEqual({
      expectedIncome: 8500,
      expectedExpense: 4529.4,
      expectedBalance: 3970.6,
      realized: { totalIncome: 8500, totalExpense: 2310.15 },
      scheduled: { totalIncome: 0, totalExpense: 1180 },
      recurringNotYetGenerated: { totalIncome: 0, totalExpense: 389.9 },
      variableEstimate: 649.35,
      usualExpense: 5100.4,
      basisMonths: 3,
      hasHistory: true,
    });
  });

  it('passes a null usualExpense through', () => {
    const summary = makeSummary({
      projection: makeProjection({ usualExpense: null, hasHistory: false }),
    });

    expect(
      MonthSummaryPresenter.toHTTP(summary).projection.usualExpense,
    ).toBeNull();
  });

  it('keeps the existing fields unchanged', () => {
    expect(MonthSummaryPresenter.toHTTP(makeSummary())).toEqual({
      projection: expect.any(Object),
      month: new Date('2026-09-01T03:00:00.000Z'),
      totalIncome: 8500,
      totalExpense: 2310.15,
      totalCheckingBalance: 1500,
      totalInvestmentBalance: 2000,
      totalCreditCardBalance: -300,
      currentMonthSaving: 60,
      previousMonthCompareSaving: 10,
      previousMonthToDate: { totalIncome: 10, totalExpense: 5 },
    });
  });
});
