import { MonthProjection } from '@modules/report/valueObjects/MonthProjection';
import {
  MonthSummary,
  MonthSummaryType,
} from '@modules/report/valueObjects/MonthSummary';
import { MonthSummaryPresenter } from './MonthlySummary.presenter';

type PacedMonthProjection = MonthProjection & {
  paceRemaining: number | null;
  paceBalance: number | null;
};

function makeProjection(
  overrides: Partial<PacedMonthProjection> = {},
): PacedMonthProjection {
  return {
    expectedIncome: 850000,
    expectedExpense: 392216,
    expectedBalance: 457784,
    realized: { totalIncome: 850000, totalExpense: 231015 },
    scheduled: { totalIncome: 0, totalExpense: 118000 },
    recurringNotYetGenerated: { totalIncome: 0, totalExpense: 38990 },
    fixedBillsDue: 0,
    accountedExpense: 388005,
    variableRemaining: 4211,
    paceDaily: 526,
    paceRemaining: 1100,
    paceBalance: 2000,
    daysRemaining: 8,
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
      expectedExpense: 3922.16,
      expectedBalance: 4577.84,
      realized: { totalIncome: 8500, totalExpense: 2310.15 },
      scheduled: { totalIncome: 0, totalExpense: 1180 },
      recurringNotYetGenerated: { totalIncome: 0, totalExpense: 389.9 },
      fixedBillsDue: 0,
      accountedExpense: 3880.05,
      variableRemaining: 42.11,
      paceDaily: 5.26,
      paceRemaining: 11,
      paceBalance: 20,
      daysRemaining: 8,
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

  it('passes null paced figures through', () => {
    const summary = makeSummary({
      projection: makeProjection({ paceRemaining: null, paceBalance: null }),
    });

    const { projection } = MonthSummaryPresenter.toHTTP(summary);

    expect(projection.paceRemaining).toBeNull();
    expect(projection.paceBalance).toBeNull();
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
