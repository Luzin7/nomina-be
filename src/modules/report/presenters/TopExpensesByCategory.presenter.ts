import { MoneyUtils } from '@utils/MoneyUtils';

export type TopExpensesByCategoryResult = {
  expenses: Array<{
    categoryId: string;
    categoryName: string;
    amount: number;
  }>;
  totalExpense: number;
};

export type TopExpensesByCategoryHTTP = {
  categoryId: string;
  categoryName: string;
  totalAmount: number;
  percentage: number;
};

function percentageOf(amount: number, total: number): number {
  return Number(((amount / total) * 100).toFixed(2));
}

export class TopExpensesByCategoryPresenter {
  static toHTTP(
    result: TopExpensesByCategoryResult,
  ): TopExpensesByCategoryHTTP[] {
    const { expenses, totalExpense } = result;

    if (totalExpense === 0) return [];

    let sumOfTopCategories = 0;

    const data: TopExpensesByCategoryHTTP[] = expenses.map((expense) => {
      sumOfTopCategories += expense.amount;
      return {
        categoryId: expense.categoryId,
        categoryName: expense.categoryName,
        totalAmount: MoneyUtils.centsToDecimal(expense.amount),
        percentage: percentageOf(expense.amount, totalExpense),
      };
    });

    const othersAmount = totalExpense - sumOfTopCategories;

    if (othersAmount > 0) {
      data.push({
        categoryId: 'others',
        categoryName: 'Outros',
        totalAmount: MoneyUtils.centsToDecimal(othersAmount),
        percentage: percentageOf(othersAmount, totalExpense),
      });
    }

    return data;
  }
}
