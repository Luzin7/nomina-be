import { RecurrenceFrequency } from '@constants/enums';
import { isSimilarAmount } from '@modules/report/valueObjects/FixedBills';
import {
  BILL_DETECTION_MONTHS,
  MAX_BILL_ENTRIES_PER_CATEGORY_MONTH,
} from '@modules/report/valueObjects/ProjectionRules';
import { DateProvider } from '@providers/date/contracts/DateProvider';
import { daysInMonth } from '@utils/calendarMonth';
import { localMonthKey } from '@utils/localMonth';
import { median } from '@utils/median';

export const DAY_TOLERANCE = 5;

export type BillDetectionTransaction = {
  id: string;
  categoryId: string;
  categoryName: string;
  accountId: string;
  amount: number;
  day: number;
  month: string;
};

export type ActiveBillRule = {
  categoryId: string;
  amount: number;
  frequency: RecurrenceFrequency;
  interval: number;
  startDate: Date;
  endDate: Date | null;
};

export type DetectedBillSuggestion = {
  categoryId: string;
  categoryName: string;
  accountId: string;
  suggestedTitle: string;
  amount: number;
  dayOfMonth: number;
  transactionIds: string[];
};

export type BillDetectionWindow = {
  months: string[];
  from: Date;
  to: Date;
};

type DetectionInput = {
  months: string[];
  transactions: BillDetectionTransaction[];
  activeRules: ActiveBillRule[];
};

const withinDayTolerance = (a: number, b: number): boolean =>
  Math.abs(a - b) <= DAY_TOLERANCE;

const groupBy = <T, K>(rows: T[], key: (row: T) => K): Map<K, T[]> => {
  const groups = new Map<K, T[]>();
  for (const row of rows) {
    const bucket = groups.get(key(row)) ?? [];
    bucket.push(row);
    groups.set(key(row), bucket);
  }

  return groups;
};

const isRegularDay = (days: number[]): boolean => {
  const center = median(days);

  return days.every((day) => Math.abs(day - center) <= DAY_TOLERANCE);
};

const modalAccount = (rows: BillDetectionTransaction[]): string => {
  const counts = new Map<string, number>();
  for (const row of rows) {
    counts.set(row.accountId, (counts.get(row.accountId) ?? 0) + 1);
  }

  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([accountId]) => accountId)[0];
};

const occurrenceInMonth = (month: string, dayOfMonth: number): Date => {
  const [year, monthNumber] = month.split('-').map(Number);
  const day = Math.min(dayOfMonth, daysInMonth(year, monthNumber));

  return new Date(Date.UTC(year, monthNumber - 1, day));
};

const isCoveredByRule = (
  categoryId: string,
  amount: number,
  dayOfMonth: number,
  month: string,
  rules: ActiveBillRule[],
): boolean => {
  const occurrence = occurrenceInMonth(month, dayOfMonth);

  return rules.some(
    (rule) =>
      rule.categoryId === categoryId &&
      isSimilarAmount(rule.amount, amount) &&
      rule.frequency === RecurrenceFrequency.MONTHLY &&
      rule.interval === 1 &&
      rule.startDate.getTime() <= occurrence.getTime() &&
      (rule.endDate === null || rule.endDate.getTime() >= occurrence.getTime()),
  );
};

const closestMatch = (
  pool: BillDetectionTransaction[],
  seed: BillDetectionTransaction,
  excluded: Set<string>,
): BillDetectionTransaction | undefined => {
  const candidates = pool.filter(
    (row) =>
      !excluded.has(row.id) &&
      withinDayTolerance(row.day, seed.day) &&
      isSimilarAmount(row.amount, seed.amount),
  );
  if (candidates.length === 0) return undefined;

  return [...candidates].sort(
    (a, b) =>
      Math.abs(a.amount - seed.amount) - Math.abs(b.amount - seed.amount) ||
      Math.abs(a.day - seed.day) - Math.abs(b.day - seed.day) ||
      a.id.localeCompare(b.id),
  )[0];
};

const isEligibleCategory = (
  byMonth: Map<string, BillDetectionTransaction[]>,
  months: string[],
): boolean =>
  months.every((month) => (byMonth.get(month)?.length ?? 0) >= 1) &&
  months.every(
    (month) =>
      (byMonth.get(month)?.length ?? 0) <= MAX_BILL_ENTRIES_PER_CATEGORY_MONTH,
  );

const buildCluster = (
  seed: BillDetectionTransaction,
  byMonth: Map<string, BillDetectionTransaction[]>,
  months: string[],
  used: Set<string>,
): BillDetectionTransaction[] | null => {
  const cluster = [seed];
  const accepted = new Set<string>([seed.id]);

  for (const month of [...months].reverse().slice(1)) {
    const match = closestMatch(byMonth.get(month) ?? [], seed, used);
    if (!match || accepted.has(match.id)) return null;
    cluster.push(match);
    accepted.add(match.id);
  }

  if (!isRegularDay(cluster.map((row) => row.day))) return null;

  cluster.forEach((row) => used.add(row.id));

  return cluster;
};

const toSuggestion = (
  categoryId: string,
  cluster: BillDetectionTransaction[],
): DetectedBillSuggestion => {
  const representative = cluster[0];

  return {
    categoryId,
    categoryName: representative.categoryName,
    accountId: modalAccount(cluster),
    suggestedTitle: representative.categoryName,
    amount: Math.round(median(cluster.map((row) => row.amount))),
    dayOfMonth: Math.round(median(cluster.map((row) => row.day))),
    transactionIds: cluster.map((row) => row.id),
  };
};

export const detectBillSuggestions = ({
  months,
  transactions,
  activeRules,
}: DetectionInput): DetectedBillSuggestion[] => {
  const newestMonth = months[months.length - 1];
  const byCategory = groupBy(transactions, (row) => row.categoryId);
  const suggestions: DetectedBillSuggestion[] = [];

  for (const [categoryId, rows] of byCategory) {
    const byMonth = groupBy(rows, (row) => row.month);
    if (!isEligibleCategory(byMonth, months)) continue;

    const used = new Set<string>();
    const seeds = [...(byMonth.get(newestMonth) ?? [])].sort(
      (a, b) => b.amount - a.amount || a.id.localeCompare(b.id),
    );

    for (const seed of seeds) {
      if (used.has(seed.id)) continue;

      const cluster = buildCluster(seed, byMonth, months, used);
      if (!cluster) continue;

      const suggestion = toSuggestion(categoryId, cluster);
      if (
        isCoveredByRule(
          categoryId,
          suggestion.amount,
          suggestion.dayOfMonth,
          newestMonth,
          activeRules,
        )
      ) {
        continue;
      }
      suggestions.push(suggestion);
    }
  }

  return suggestions;
};

export const billDetectionWindow = (
  now: Date,
  timezone: string,
  dateProvider: DateProvider,
): BillDetectionWindow => {
  const to = dateProvider.startOfMonth(now, timezone);
  const from = dateProvider.startOfMonth(
    dateProvider.add(to, -BILL_DETECTION_MONTHS, 'month', timezone),
    timezone,
  );
  const months = Array.from({ length: BILL_DETECTION_MONTHS }, (_, index) =>
    localMonthKey(dateProvider.add(from, index, 'month', timezone), timezone),
  );

  return { months, from, to };
};

export const isBillDetectionDue = (
  lastBillDetectionAt: Date | null,
  now: Date,
  timezone: string,
): boolean =>
  lastBillDetectionAt === null ||
  localMonthKey(lastBillDetectionAt, timezone) !== localMonthKey(now, timezone);
