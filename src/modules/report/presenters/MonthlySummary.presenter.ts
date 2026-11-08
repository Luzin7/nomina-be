import { MoneyUtils } from '@utils/MoneyUtils';
import {
  MonthSummary,
  PeriodTotals,
} from '@modules/report/valueObjects/MonthSummary';

const toDecimal = (cents: number) => MoneyUtils.centsToDecimal(cents);

const periodTotalsToHTTP = (totals: PeriodTotals) => ({
  totalIncome: toDecimal(totals.totalIncome),
  totalExpense: toDecimal(totals.totalExpense),
});

export class MonthSummaryPresenter {
  static toHTTP(monthSummary: MonthSummary) {
    const { projection } = monthSummary;

    return {
      month: monthSummary.month,
      totalIncome: MoneyUtils.centsToDecimal(monthSummary.totalIncome ?? 0),
      totalExpense: MoneyUtils.centsToDecimal(monthSummary.totalExpense ?? 0),
      totalCheckingBalance: MoneyUtils.centsToDecimal(
        monthSummary.totalCheckingBalance ?? 0,
      ),
      totalInvestmentBalance: MoneyUtils.centsToDecimal(
        monthSummary.totalInvestmentBalance ?? 0,
      ),
      totalCreditCardBalance: MoneyUtils.centsToDecimal(
        monthSummary.totalCreditCardBalance ?? 0,
      ),
      currentMonthSaving: monthSummary.rate.currentMonthSaving,
      previousMonthCompareSaving: monthSummary.rate.previousMonthCompareSaving,
      previousMonthToDate: {
        totalIncome: MoneyUtils.centsToDecimal(
          monthSummary.previousMonthToDate.totalIncome,
        ),
        totalExpense: MoneyUtils.centsToDecimal(
          monthSummary.previousMonthToDate.totalExpense,
        ),
      },
      projection: {
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
        paceDaily:
          projection.paceDaily === null
            ? null
            : toDecimal(projection.paceDaily),
        paceRemaining:
          projection.paceRemaining === null
            ? null
            : toDecimal(projection.paceRemaining),
        paceBalance:
          projection.paceBalance === null
            ? null
            : toDecimal(projection.paceBalance),
        daysRemaining: projection.daysRemaining,
        usualExpense:
          projection.usualExpense === null
            ? null
            : toDecimal(projection.usualExpense),
        basisMonths: projection.basisMonths,
        hasHistory: projection.hasHistory,
      },
    };
  }
}
