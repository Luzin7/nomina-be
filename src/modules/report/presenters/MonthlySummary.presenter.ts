import { MoneyUtils } from '@utils/MoneyUtils';
import { MonthSummary } from '@modules/report/valueObjects/MonthSummary';
import { toHTTPProjection } from './MonthProjection.presenter';

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
      projection: toHTTPProjection(projection),
    };
  }
}
