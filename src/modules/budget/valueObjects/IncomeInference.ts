import { median } from '@utils/median';

export const MIN_INCOME_MONTHS = 3;

export type IncomeInference = {
  incomeCents: number;
  incomeMonths: number;
  zeroIncomeMonths: number;
};

export function inferIncome(monthlyIncomes: number[]): IncomeInference | null {
  const incomes = monthlyIncomes.filter((income) => income > 0);
  if (incomes.length < MIN_INCOME_MONTHS) return null;

  return {
    incomeCents: Math.round(median(incomes)),
    incomeMonths: incomes.length,
    zeroIncomeMonths: monthlyIncomes.length - incomes.length,
  };
}
