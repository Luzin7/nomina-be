import { RecurrenceFrequency } from '@constants/enums';
import {
  detectFixedBills,
  FixedBill,
  isSimilarAmount,
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
import { RecurrenceRule, walkOccurrences } from '@utils/recurrenceWalk';

export type RecurringRuleSnapshot = RecurrenceRule & {
  id: string;
  type: 'INCOME' | 'EXPENSE';
  categoryId: string | null;
  amount: number;
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
  fixedBillsDue: number;
  accountedExpense: number;
  variableRemaining: number;
  paceDaily: number | null;
  paceRemaining: number | null;
  paceBalance: number | null;
  daysRemaining: number;
  usualExpense: number | null;
  basisMonths: number;
  hasHistory: boolean;
};

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

export const selectBasisMonths = (
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

const variableRows = (month: LedgerMonth, bills: FixedBill[]): PlainExpense[] =>
  completedRows(month).filter((row) => !isSimilarToAnyBill(row, bills));

const windowVariableExpense = (
  month: LedgerMonth,
  bills: FixedBill[],
  currentDay: number,
): number =>
  sumAmounts(variableRows(month, bills).filter((row) => row.day > currentDay));

const habitualVariableRemaining = (
  basis: LedgerMonth[],
  bills: FixedBill[],
  currentDay: number,
): number =>
  Math.round(
    median(
      basis.map((month) => windowVariableExpense(month, bills, currentDay)),
    ),
  );

const currentVariableSpent = (
  rows: PlainExpense[],
  bills: FixedBill[],
  dayOfMonth: number,
): number =>
  sumAmounts(
    rows.filter(
      (row) =>
        !row.pending &&
        row.day <= dayOfMonth &&
        !isSimilarToAnyBill(row, bills),
    ),
  );

const currentDailyPaceExact = (
  rows: PlainExpense[],
  bills: FixedBill[],
  dayOfMonth: number,
): number =>
  currentVariableSpent(rows, bills, dayOfMonth) / Math.max(1, dayOfMonth);

const usualMonthlyExpense = (
  basis: LedgerMonth[],
  monthDays: number,
): number => {
  const dailyExpense = median(
    basis.map((month) => month.totalExpense / daysInKeyedMonth(month.key)),
  );

  return Math.round(dailyExpense * monthDays);
};

const ruleOccursInMonth = (
  rule: RecurringRuleSnapshot,
  month: MonthProjectionInput['month'],
  nextOccurrence: MonthProjectionInput['nextOccurrence'],
): boolean =>
  walkOccurrences({
    rule: { ...rule, lastGenerated: null, materializedDates: [] },
    from: month.start,
    until: month.end,
    nextOccurrence: (date) => nextOccurrence(date, rule),
    limit: 1,
  }).length > 0;

const isCoveredByActiveRule = (
  bill: FixedBill,
  rules: RecurringRuleSnapshot[],
  month: MonthProjectionInput['month'],
  nextOccurrence: MonthProjectionInput['nextOccurrence'],
): boolean =>
  rules.some(
    (rule) =>
      rule.type === 'EXPENSE' &&
      rule.frequency === RecurrenceFrequency.MONTHLY &&
      rule.interval === 1 &&
      rule.categoryId === bill.categoryId &&
      isSimilarAmount(rule.amount, bill.amount) &&
      ruleOccursInMonth(rule, month, nextOccurrence),
  );

const dropCoveredBills = (
  bills: FixedBill[],
  rules: RecurringRuleSnapshot[],
  month: MonthProjectionInput['month'],
  nextOccurrence: MonthProjectionInput['nextOccurrence'],
): FixedBill[] =>
  bills.filter(
    (bill) => !isCoveredByActiveRule(bill, rules, month, nextOccurrence),
  );

const sumRuleOccurrences = (
  rule: RecurringRuleSnapshot,
  month: MonthProjectionInput['month'],
  nextOccurrence: MonthProjectionInput['nextOccurrence'],
): number =>
  walkOccurrences({
    rule,
    from: month.start,
    until: month.end,
    nextOccurrence,
  }).length * rule.amount;

export const sumNotYetGeneratedOccurrences = (
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

  const detectedBills = hasHistory ? detectFixedBills(basis) : [];
  const billsToProject = dropCoveredBills(
    detectedBills,
    input.recurringRules,
    month,
    input.nextOccurrence,
  );
  const fixedBillsDue = hasHistory
    ? sumFixedBillsDue(billsToProject, currentRows)
    : 0;
  const variableRemaining = hasHistory
    ? habitualVariableRemaining(basis, detectedBills, input.dayOfMonth)
    : 0;
  const paceDailyExact = hasHistory
    ? currentDailyPaceExact(currentRows, detectedBills, input.dayOfMonth)
    : null;
  const paceDaily = paceDailyExact === null ? null : Math.round(paceDailyExact);
  const daysRemaining = Math.max(0, month.days - Math.max(0, input.dayOfMonth));
  const paceRemaining =
    paceDailyExact === null ? null : Math.round(paceDailyExact * daysRemaining);

  const expectedIncome =
    realized.totalIncome + scheduled.totalIncome + recurring.totalIncome;
  const accountedExpense =
    realized.totalExpense + scheduled.totalExpense + recurring.totalExpense;
  const expectedExpense = accountedExpense + fixedBillsDue + variableRemaining;
  const paceBalance =
    paceRemaining === null
      ? null
      : expectedIncome - (accountedExpense + fixedBillsDue + paceRemaining);

  return {
    expectedIncome,
    expectedExpense,
    expectedBalance: expectedIncome - expectedExpense,
    realized,
    scheduled,
    recurringNotYetGenerated: recurring,
    fixedBillsDue,
    accountedExpense,
    variableRemaining,
    paceDaily,
    paceRemaining,
    paceBalance,
    daysRemaining,
    usualExpense: hasHistory ? usualMonthlyExpense(basis, month.days) : null,
    basisMonths: basis.length,
    hasHistory,
  };
};
