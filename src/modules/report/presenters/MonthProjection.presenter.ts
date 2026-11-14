import type { MonthProjection } from '@modules/report/valueObjects/MonthProjection';
import type { PeriodTotals } from '@modules/report/valueObjects/MonthSummary';
import { MoneyUtils } from '@utils/MoneyUtils';

const toDecimal = (cents: number) => MoneyUtils.centsToDecimal(cents);

const periodTotalsToHTTP = (totals: PeriodTotals) => ({
  totalIncome: toDecimal(totals.totalIncome),
  totalExpense: toDecimal(totals.totalExpense),
});

const optionalDecimal = (cents: number | null) =>
  cents === null ? null : toDecimal(cents);

export function toHTTPProjection(projection: MonthProjection) {
  return {
    expectedIncome: toDecimal(projection.expectedIncome),
    expectedExpense: toDecimal(projection.expectedExpense),
    expectedBalance: toDecimal(projection.expectedBalance),
    realized: periodTotalsToHTTP(projection.realized),
    scheduled: periodTotalsToHTTP(projection.scheduled),
    recurringNotYetGenerated: periodTotalsToHTTP(
      projection.recurringNotYetGenerated,
    ),
    fixedBillsDue: toDecimal(projection.fixedBillsDue),
    accountedExpense: toDecimal(projection.accountedExpense),
    variableRemaining: toDecimal(projection.variableRemaining),
    paceDaily: optionalDecimal(projection.paceDaily),
    paceRemaining: optionalDecimal(projection.paceRemaining),
    paceBalance: optionalDecimal(projection.paceBalance),
    daysRemaining: projection.daysRemaining,
    usualExpense: optionalDecimal(projection.usualExpense),
    basisMonths: projection.basisMonths,
    hasHistory: projection.hasHistory,
  };
}
