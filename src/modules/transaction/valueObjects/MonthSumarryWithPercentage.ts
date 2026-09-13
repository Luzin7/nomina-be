import { ValueObject } from '@shared/core/Entities/ValueObject';

export type MonthSummaryType = {
  month: Date;
  totalIncome: number;
  totalExpense: number;
  totalInvestments: number;
  totalCheckingBalance: number;
  totalInvestmentBalance: number;
  totalCreditCardBalance: number;
  rate: {
    currentMonthSaving: number;
    previousMonthCompareSaving: number;
  };
};

export class MonthSummary extends ValueObject<MonthSummaryType> {
  constructor(props: MonthSummaryType) {
    super(props);
  }

  static create(props: MonthSummaryType): MonthSummary {
    return new MonthSummary(props);
  }

  get month() {
    return this.props.month;
  }

  get totalIncome() {
    return this.props.totalIncome;
  }

  get totalExpense() {
    return this.props.totalExpense;
  }

  get totalInvestments() {
    return this.props.totalInvestments;
  }

  get totalCheckingBalance() {
    return this.props.totalCheckingBalance;
  }

  get totalInvestmentBalance() {
    return this.props.totalInvestmentBalance;
  }

  get totalCreditCardBalance() {
    return this.props.totalCreditCardBalance;
  }

  get rate() {
    return this.props.rate;
  }
}
