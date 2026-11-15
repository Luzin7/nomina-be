import {
  MIN_ACTIVE_DAYS,
  PROVISIONAL_DAY_CAP_RATIO,
  PROVISIONAL_EXPENSE_CAP_MIN_EXPENSES,
  PROVISIONAL_EXPENSE_CAP_RATIO,
  PROVISIONAL_MIN_WINDOW_DAYS,
  PROVISIONAL_WINDOW_DAYS,
} from '@modules/report/valueObjects/ProjectionRules';
import { median } from '@utils/median';

export type PlainExpenseOn = { date: string; amount: number };

export type ProvisionalBasis = {
  confidence: 'initial' | 'observed';
  frozen: boolean;
  recurringExpenseCents: number;
  recurringDueCents: number;
  dailyRateCents: number;
  observedDays: number;
  activeDays: number;
  minActiveDays: number;
  windowStart: string;
  windowEnd: string;
};

export type ProvisionalPlan =
  | { kind: 'nothing-observed' }
  | { kind: 'provisional'; planTotalCents: number; basis: ProvisionalBasis };

export type ProvisionalPlanInput = {
  today: string;
  daysInMonth: number;
  expenses: PlainExpenseOn[];
  spentCents: number;
  recurringExpenseCents: number;
  recurringDueCents: number;
};

type DatedExpense = { day: number; amount: number };

type ObservationWindow = {
  start: number;
  end: number;
  frozen: boolean;
  rows: DatedExpense[];
};

const MS_PER_DAY = 86_400_000;

const dayNumberOf = (isoDate: string): number => {
  const [year, month, day] = isoDate.split('-').map(Number);

  return Date.UTC(year, month - 1, day) / MS_PER_DAY;
};

const isoDateOf = (dayNumber: number): string =>
  new Date(dayNumber * MS_PER_DAY).toISOString().slice(0, 10);

const sum = (values: number[]): number =>
  values.reduce((total, value) => total + value, 0);

const rowsBetween = (
  rows: DatedExpense[],
  start: number,
  end: number,
): DatedExpense[] => rows.filter(({ day }) => day >= start && day <= end);

const activeDaysOf = (rows: DatedExpense[]): number =>
  new Set(rows.map(({ day }) => day)).size;

const selectWindow = (
  rows: DatedExpense[],
  monthStart: number,
  today: number,
): ObservationWindow | null => {
  const firstDay = Math.min(...rows.map(({ day }) => day));
  const priorStart = Math.max(firstDay, monthStart - PROVISIONAL_WINDOW_DAYS);
  const priorEnd = monthStart - 1;
  const prior = rowsBetween(rows, priorStart, priorEnd);
  if (activeDaysOf(prior) >= MIN_ACTIVE_DAYS) {
    return { start: priorStart, end: priorEnd, frozen: true, rows: prior };
  }

  const start = Math.max(firstDay, today - PROVISIONAL_WINDOW_DAYS + 1);
  const current = rowsBetween(rows, start, today);
  if (current.length === 0) return null;

  return { start, end: today, frozen: false, rows: current };
};

const cappedDaysTotal = (rows: DatedExpense[]): number => {
  const byDay = new Map<number, number>();
  for (const { day, amount } of rows) {
    byDay.set(day, (byDay.get(day) ?? 0) + amount);
  }
  const totals = [...byDay.values()];
  const cap = PROVISIONAL_DAY_CAP_RATIO * median(totals);

  return sum(totals.map((total) => Math.min(total, cap)));
};

const cappedExpensesTotal = (rows: DatedExpense[]): number => {
  const amounts = rows.map(({ amount }) => amount);
  if (amounts.length < PROVISIONAL_EXPENSE_CAP_MIN_EXPENSES) {
    return sum(amounts);
  }
  const cap = PROVISIONAL_EXPENSE_CAP_RATIO * median(amounts);

  return sum(amounts.map((amount) => Math.min(amount, cap)));
};

const dailyRateOf = (
  window: ObservationWindow,
  isObserved: boolean,
  calendarDays: number,
): number =>
  isObserved
    ? cappedDaysTotal(window.rows) / calendarDays
    : cappedExpensesTotal(window.rows) /
      Math.max(calendarDays, PROVISIONAL_MIN_WINDOW_DAYS);

const planTotalOf = (
  input: ProvisionalPlanInput,
  window: ObservationWindow,
  rate: number,
): number => {
  if (window.frozen) {
    return input.recurringExpenseCents + Math.round(rate * input.daysInMonth);
  }
  const daysRemaining = input.daysInMonth - Number(input.today.slice(8, 10));

  return (
    input.spentCents +
    input.recurringDueCents +
    Math.round(rate * Math.max(daysRemaining, 0))
  );
};

export function buildProvisionalPlan(
  input: ProvisionalPlanInput,
): ProvisionalPlan {
  const today = dayNumberOf(input.today);
  const rows = input.expenses
    .map(({ date, amount }) => ({ day: dayNumberOf(date), amount }))
    .filter(({ day }) => day <= today);
  if (rows.length === 0) return { kind: 'nothing-observed' };

  const monthStart = dayNumberOf(`${input.today.slice(0, 8)}01`);
  const window = selectWindow(rows, monthStart, today);
  if (!window) return { kind: 'nothing-observed' };

  const activeDays = activeDaysOf(window.rows);
  const isObserved = window.frozen || activeDays >= MIN_ACTIVE_DAYS;
  const calendarDays = window.end - window.start + 1;
  const rate = dailyRateOf(window, isObserved, calendarDays);

  return {
    kind: 'provisional',
    planTotalCents: planTotalOf(input, window, rate),
    basis: {
      confidence: isObserved ? 'observed' : 'initial',
      frozen: window.frozen,
      recurringExpenseCents: input.recurringExpenseCents,
      recurringDueCents: input.recurringDueCents,
      dailyRateCents: Math.round(rate),
      observedDays: calendarDays,
      activeDays,
      minActiveDays: MIN_ACTIVE_DAYS,
      windowStart: isoDateOf(window.start),
      windowEnd: isoDateOf(window.end),
    },
  };
}
