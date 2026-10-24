import { RecurrenceFrequency } from '@constants/enums';
import {
  detectFixedBills,
  FixedBill,
  isSimilarToAnyBill,
  sumFixedBillsDue,
} from '@modules/report/valueObjects/FixedBills';
import {
  LedgerMonth,
  LOOKBACK_MONTHS,
  MAX_BASIS_MONTHS,
  MIN_ACTIVE_DAYS,
  MIN_BASIS_MONTHS,
  PlainExpense,
} from '@modules/report/valueObjects/ProjectionRules';
import { PeriodTotals } from '@modules/report/valueObjects/MonthSummary';
import { daysInMonth } from '@utils/calendarMonth';
import { median } from '@utils/median';

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

export type { LedgerMonth, PlainExpense };

export type MonthProjectionInput = {
  month: { key: string; start: Date; end: Date; days: number };
  dayOfMonth: number;
  ledger: LedgerMonth[];
  realized: PeriodTotals;
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

const NO_HISTORY_VARIABLE_ESTIMATE = 0;

const monthIndex = (key: string): number => {
  const [year, month] = key.split('-').map(Number);

  return year * 12 + month - 1;
};

const daysInKeyedMonth = (key: string): number => {
  const [year, month] = key.split('-').map(Number);

  return daysInMonth(year, month);
};

const completedRows = (month: LedgerMonth): PlainExpense[] =>
  month.plainExpenses.filter((row) => !row.pending);

const isActiveMonth = (month: LedgerMonth): boolean =>
  new Set(completedRows(month).map((row) => row.day)).size >= MIN_ACTIVE_DAYS;

const selectBasisMonths = (
  ledger: LedgerMonth[],
  currentKey: string,
): LedgerMonth[] => {
  const current = monthIndex(currentKey);

  return ledger
    .filter((month) => {
      const age = current - monthIndex(month.key);

      return age >= 1 && age <= LOOKBACK_MONTHS && isActiveMonth(month);
    })
    .sort((a, b) => monthIndex(b.key) - monthIndex(a.key))
    .slice(0, MAX_BASIS_MONTHS);
};

const sumAmounts = (rows: PlainExpense[]): number =>
  rows.reduce((total, row) => total + row.amount, 0);

const sumVariableBetween = (
  rows: PlainExpense[],
  firstDay: number,
  lastDay: number,
): number =>
  sumAmounts(rows.filter((row) => row.day >= firstDay && row.day <= lastDay));

const estimateVariableWindow = (
  basis: LedgerMonth[],
  bills: FixedBill[],
  currentRows: PlainExpense[],
  dayOfMonth: number,
  daysAfterToday: number,
): number => {
  const notFixed = (rows: PlainExpense[]) =>
    rows.filter((row) => !isSimilarToAnyBill(row, bills));

  const windows = basis.map((month) => {
    const rows = notFixed(completedRows(month));
    const days = daysInKeyedMonth(month.key);
    const sliceDay = Math.min(dayOfMonth, days);
    const lastDay = Math.min(days, sliceDay + daysAfterToday);

    return {
      slice: sumVariableBetween(rows, sliceDay, sliceDay),
      after: sumVariableBetween(rows, sliceDay + 1, lastDay),
    };
  });
  const todayVariable = sumVariableBetween(
    notFixed(currentRows),
    dayOfMonth,
    dayOfMonth,
  );
  const sliceRemainder = Math.max(
    0,
    median(windows.map((window) => window.slice)) - todayVariable,
  );

  return Math.round(
    median(windows.map((window) => window.after)) + sliceRemainder,
  );
};

const usualMonthlyExpense = (
  basis: LedgerMonth[],
  monthDays: number,
): number => {
  const dailyExpense = median(
    basis.map((month) => month.totalExpense / daysInKeyedMonth(month.key)),
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

const NO_TOTALS: PeriodTotals = {
  totalIncome: 0,
  totalExpense: 0,
};

export const projectMonthEnd = (
  input: MonthProjectionInput,
): MonthProjection => {
  const { month, realized } = input;
  const currentLedger = input.ledger.find((entry) => entry.key === month.key);
  const scheduled = currentLedger?.pending ?? NO_TOTALS;
  const currentRows = currentLedger?.plainExpenses ?? [];
  const recurring = sumNotYetGeneratedOccurrences(input);
  const basis = selectBasisMonths(input.ledger, month.key);
  const hasHistory = basis.length >= MIN_BASIS_MONTHS;

  const bills = hasHistory ? detectFixedBills(basis) : [];
  const variableEstimate = hasHistory
    ? sumFixedBillsDue(bills, currentRows) +
      estimateVariableWindow(
        basis,
        bills,
        currentRows.filter((row) => !row.pending),
        input.dayOfMonth,
        month.days - input.dayOfMonth,
      )
    : NO_HISTORY_VARIABLE_ESTIMATE;

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
    usualExpense: hasHistory ? usualMonthlyExpense(basis, month.days) : null,
    basisMonths: basis.length,
    hasHistory,
  };
};
