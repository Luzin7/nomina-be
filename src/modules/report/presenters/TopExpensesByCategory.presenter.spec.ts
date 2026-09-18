import {
  TopExpensesByCategoryPresenter,
  type TopExpensesByCategoryResult,
} from './TopExpensesByCategory.presenter';

function makeResult(
  overrides: Partial<TopExpensesByCategoryResult> = {},
): TopExpensesByCategoryResult {
  return { expenses: [], totalExpense: 0, ...overrides };
}

describe('TopExpensesByCategoryPresenter', () => {
  it('returns empty when there is no expense', () => {
    expect(TopExpensesByCategoryPresenter.toHTTP(makeResult())).toEqual([]);
  });

  it('converts cents and computes percentages', () => {
    const result = makeResult({
      expenses: [
        { categoryId: 'cat-a', categoryName: 'Petshop', amount: 6000 },
        { categoryId: 'cat-b', categoryName: 'Mercado', amount: 2000 },
      ],
      totalExpense: 10000,
    });

    expect(TopExpensesByCategoryPresenter.toHTTP(result)).toEqual([
      {
        categoryId: 'cat-a',
        categoryName: 'Petshop',
        totalAmount: 60,
        percentage: 60,
      },
      {
        categoryId: 'cat-b',
        categoryName: 'Mercado',
        totalAmount: 20,
        percentage: 20,
      },
      {
        categoryId: 'others',
        categoryName: 'Outros',
        totalAmount: 20,
        percentage: 20,
      },
    ]);
  });

  it('omits Outros when top categories cover the total', () => {
    const result = makeResult({
      expenses: [
        { categoryId: 'cat-a', categoryName: 'Petshop', amount: 10000 },
      ],
      totalExpense: 10000,
    });

    expect(TopExpensesByCategoryPresenter.toHTTP(result)).toHaveLength(1);
  });
});
