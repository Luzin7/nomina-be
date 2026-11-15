import { median } from '@utils/median';

export const MIN_INCOME_MONTHS = 3;
const STABLE_FLOOR_RATIO = 0.8;

export type IncomeBase = 'median' | 'lowest';

export type IncomeInference = {
  incomeCents: number;
  base: IncomeBase;
  incomeMonths: number;
  zeroIncomeMonths: number;
};

export function inferIncome(monthlyIncomes: number[]): IncomeInference | null {
  const incomes = monthlyIncomes.filter((income) => income > 0);
  if (incomes.length < MIN_INCOME_MONTHS) return null;

  const zeroIncomeMonths = monthlyIncomes.length - incomes.length;
  const typical = median(incomes);
  const lowest = Math.min(...incomes);
  const stable =
    zeroIncomeMonths === 0 && lowest >= STABLE_FLOOR_RATIO * typical;

  return {
    incomeCents: Math.round(stable ? typical : lowest),
    base: stable ? 'median' : 'lowest',
    incomeMonths: incomes.length,
    zeroIncomeMonths,
  };
}
