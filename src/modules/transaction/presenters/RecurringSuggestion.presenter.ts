import { RecurringSuggestion } from '../entities/RecurringSuggestion';

type SuggestionView = {
  suggestion: RecurringSuggestion;
  categoryName: string;
  accountName: string;
};

export class RecurringSuggestionPresenter {
  static toHTTP({ suggestion, categoryName, accountName }: SuggestionView) {
    return {
      id: suggestion.id,
      categoryId: suggestion.categoryId,
      categoryName,
      accountId: suggestion.accountId,
      accountName,
      suggestedTitle: suggestion.suggestedTitle,
      amount: Number(suggestion.amount),
      dayOfMonth: suggestion.dayOfMonth,
      shownAt: suggestion.shownAt,
      createdAt: suggestion.createdAt,
    };
  }
}
