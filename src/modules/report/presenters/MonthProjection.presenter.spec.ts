import { MonthProjection } from '@modules/report/valueObjects/MonthProjection';
import { toHTTPProjection } from './MonthProjection.presenter';

function makeProjection(
  overrides: Partial<MonthProjection> = {},
): MonthProjection {
  return {
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
    ...overrides,
  };
}

describe('toHTTPProjection', () => {
  it('converts cents to decimals', () => {
    expect(toHTTPProjection(makeProjection())).toEqual({
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

  it('passes null figures through', () => {
    const projection = toHTTPProjection(
      makeProjection({
        paceDaily: null,
        paceRemaining: null,
        paceBalance: null,
        usualExpense: null,
        hasHistory: false,
      }),
    );

    expect(projection.paceDaily).toBeNull();
    expect(projection.paceRemaining).toBeNull();
    expect(projection.paceBalance).toBeNull();
    expect(projection.usualExpense).toBeNull();
  });
});
