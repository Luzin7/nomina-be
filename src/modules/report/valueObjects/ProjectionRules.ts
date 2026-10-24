import type { PeriodTotals } from '@modules/report/valueObjects/MonthSummary';

export const MIN_BASIS_MONTHS = 3;
export const MAX_BASIS_MONTHS = 6;
export const LOOKBACK_MONTHS = 12;
export const MIN_ACTIVE_DAYS = 5;
export const BILL_DETECTION_MONTHS = 3;
export const MAX_BILL_ENTRIES_PER_CATEGORY_MONTH = 2;
export const SIMILAR_AMOUNT_RATIO = 1.5;

export type PlainExpense = {
  day: number;
  categoryId: string;
  amount: number;
  pending: boolean;
};

export type LedgerMonth = {
  key: string;
  totalExpense: number;
  pending: PeriodTotals;
  plainExpenses: PlainExpense[];
};
