import { RecurrenceFrequency } from '@constants/enums';
import { PeriodTotals } from '@modules/report/valueObjects/MonthSummary';

export type RecurringRuleSnapshot = {
  id: string;
  type: 'INCOME' | 'EXPENSE';
  amount: number;
  frequency: RecurrenceFrequency;
  interval: number;
  startDate: Date;
  endDate: Date | null;
  lastGenerated: Date | null;
  materializedDates: Date[];
};

export type BasisMonth = {
  start: Date;
  days: number;
  totalExpense: number;
  variableExpense: number;
};

export type MonthProjectionInput = {
  month: { start: Date; end: Date; days: number };
  dayOfMonth: number;
  realized: PeriodTotals;
  scheduled: PeriodTotals;
  variableExpenseToday: number;
  basis: BasisMonth[];
  firstActivityAt: Date | null;
  recurringRules: RecurringRuleSnapshot[];
  nextOccurrence: (date: Date, rule: RecurringRuleSnapshot) => Date;
};

export type MonthProjection = {
  expectedIncome: number;
  expectedExpense: number;
  expectedBalance: number;
  realized: PeriodTotals;
  scheduled: PeriodTotals;
  recurringNotYetGenerated: PeriodTotals;
  variableEstimate: number;
  usualExpense: number | null;
  basisMonths: number;
  hasHistory: boolean;
};

const MAX_OCCURRENCE_STEPS = 1000;
const MAX_BASIS_MONTHS = 3;

const median = (values: number[]): number => {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[middle];

  return (sorted[middle - 1] + sorted[middle]) / 2;
};

const countedBasisMonths = (
  basis: BasisMonth[],
  firstActivityAt: Date | null,
): BasisMonth[] => {
  if (firstActivityAt === null) return [];

  return basis
    .filter((month) => firstActivityAt.getTime() <= month.start.getTime())
    .slice(0, MAX_BASIS_MONTHS);
};

const estimateVariableSpending = (
  counted: BasisMonth[],
  daysAfterToday: number,
  variableExpenseToday: number,
): number => {
  if (counted.length === 0) return 0;

  const dailyRate = median(
    counted.map((month) => month.variableExpense / month.days),
  );
  const todayRemainder = Math.max(0, dailyRate - variableExpenseToday);

  return Math.round(dailyRate * daysAfterToday + todayRemainder);
};

const usualMonthlyExpense = (
  counted: BasisMonth[],
  monthDays: number,
): number | null => {
  if (counted.length === 0) return null;

  const dailyExpense = median(
    counted.map((month) => month.totalExpense / month.days),
  );

  return Math.round(dailyExpense * monthDays);
};

const isMaterialized = (rule: RecurringRuleSnapshot, date: Date): boolean =>
  rule.materializedDates.some((d) => d.getTime() === date.getTime());

const isPendingOccurrence = (
  rule: RecurringRuleSnapshot,
  cursor: Date,
  monthStart: Date,
): boolean =>
  cursor.getTime() >= monthStart.getTime() && !isMaterialized(rule, cursor);

const isBeyondRuleEnd = (rule: RecurringRuleSnapshot, cursor: Date): boolean =>
  rule.endDate !== null && cursor.getTime() > rule.endDate.getTime();

const sumRuleOccurrences = (
  rule: RecurringRuleSnapshot,
  month: MonthProjectionInput['month'],
  nextOccurrence: MonthProjectionInput['nextOccurrence'],
): number => {
  let cursor = rule.lastGenerated
    ? nextOccurrence(rule.lastGenerated, rule)
    : rule.startDate;
  let total = 0;

  for (let step = 0; step < MAX_OCCURRENCE_STEPS; step++) {
    if (cursor.getTime() > month.end.getTime()) break;
    if (isBeyondRuleEnd(rule, cursor)) break;
    if (isPendingOccurrence(rule, cursor, month.start)) total += rule.amount;
    cursor = nextOccurrence(cursor, rule);
  }

  return total;
};

const sumNotYetGeneratedOccurrences = (
  input: Pick<
    MonthProjectionInput,
    'month' | 'recurringRules' | 'nextOccurrence'
  >,
): PeriodTotals => {
  const totals: PeriodTotals = { totalIncome: 0, totalExpense: 0 };

  for (const rule of input.recurringRules) {
    const amount = sumRuleOccurrences(rule, input.month, input.nextOccurrence);
    if (rule.type === 'INCOME') totals.totalIncome += amount;
    if (rule.type === 'EXPENSE') totals.totalExpense += amount;
  }

  return totals;
};

export const projectMonthEnd = (
  input: MonthProjectionInput,
): MonthProjection => {
  const { month, realized, scheduled } = input;
  const counted = countedBasisMonths(input.basis, input.firstActivityAt);
  const recurring = sumNotYetGeneratedOccurrences(input);
  const variableEstimate = estimateVariableSpending(
    counted,
    month.days - input.dayOfMonth,
    input.variableExpenseToday,
  );

  const expectedIncome =
    realized.totalIncome + scheduled.totalIncome + recurring.totalIncome;
  const expectedExpense =
    realized.totalExpense +
    scheduled.totalExpense +
    recurring.totalExpense +
    variableEstimate;

  return {
    expectedIncome,
    expectedExpense,
    expectedBalance: expectedIncome - expectedExpense,
    realized,
    scheduled,
    recurringNotYetGenerated: recurring,
    variableEstimate,
    usualExpense: usualMonthlyExpense(counted, month.days),
    basisMonths: counted.length,
    hasHistory: counted.length > 0,
  };
};
