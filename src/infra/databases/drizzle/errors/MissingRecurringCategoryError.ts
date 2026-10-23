export class MissingRecurringCategoryError extends Error {
  constructor(recurringTransactionId: string) {
    super(
      `recurring_transactions.category_id is null for "${recurringTransactionId}"`,
    );
    this.name = 'MissingRecurringCategoryError';
  }
}
