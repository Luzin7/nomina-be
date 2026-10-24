import {
  BILL_DETECTION_MONTHS,
  LedgerMonth,
  MAX_BILL_ENTRIES_PER_CATEGORY_MONTH,
  PlainExpense,
  SIMILAR_AMOUNT_RATIO,
} from '@modules/report/valueObjects/ProjectionRules';
import { median } from '@utils/median';

export type FixedBill = { categoryId: string; amount: number };

export const isSimilarAmount = (a: number, b: number): boolean => {
  const smallest = Math.min(a, b);
  if (smallest <= 0) return false;

  return Math.max(a, b) / smallest <= SIMILAR_AMOUNT_RATIO;
};

export const isSimilarToAnyBill = (
  row: PlainExpense,
  bills: FixedBill[],
): boolean =>
  bills.some(
    (bill) =>
      bill.categoryId === row.categoryId &&
      isSimilarAmount(bill.amount, row.amount),
  );

const takeClosestSimilar = (
  pool: PlainExpense[],
  target: { categoryId: string; amount: number },
): PlainExpense | undefined => {
  let closestIndex = -1;
  let closestGap = Infinity;

  pool.forEach((row, index) => {
    if (row.categoryId !== target.categoryId) return;
    if (!isSimilarAmount(row.amount, target.amount)) return;
    const gap = Math.abs(row.amount - target.amount);
    if (gap >= closestGap) return;
    closestIndex = index;
    closestGap = gap;
  });
  if (closestIndex === -1) return undefined;

  return pool.splice(closestIndex, 1)[0];
};

const eligibleRows = (month: LedgerMonth): PlainExpense[] => {
  const completed = month.plainExpenses.filter((row) => !row.pending);
  const countByCategory = new Map<string, number>();
  for (const row of completed) {
    countByCategory.set(
      row.categoryId,
      (countByCategory.get(row.categoryId) ?? 0) + 1,
    );
  }

  return completed.filter(
    (row) =>
      (countByCategory.get(row.categoryId) ?? 0) <=
      MAX_BILL_ENTRIES_PER_CATEGORY_MONTH,
  );
};

export const detectFixedBills = (basis: LedgerMonth[]): FixedBill[] => {
  if (basis.length === 0) return [];

  const [newest, ...older] = basis.slice(0, BILL_DETECTION_MONTHS);

  const olderPools = older.map(eligibleRows);
  const bills: FixedBill[] = [];
  const candidates = eligibleRows(newest).sort((a, b) => b.amount - a.amount);

  for (const row of candidates) {
    const matches = olderPools
      .map((pool) => takeClosestSimilar(pool, row))
      .filter((match): match is PlainExpense => match !== undefined);
    if (matches.length === 0) continue;

    bills.push({
      categoryId: row.categoryId,
      amount: Math.round(
        median([row.amount, ...matches.map((match) => match.amount)]),
      ),
    });
  }

  return bills;
};

export const sumFixedBillsDue = (
  bills: FixedBill[],
  currentMonthExpenses: PlainExpense[],
): number => {
  const pool = [...currentMonthExpenses];

  return bills
    .filter((bill) => takeClosestSimilar(pool, bill) === undefined)
    .reduce((total, bill) => total + bill.amount, 0);
};
