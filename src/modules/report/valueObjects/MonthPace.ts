import { RecurringRuleSnapshot } from '@modules/report/valueObjects/MonthProjection';

export type MonthPaceDay = {
  day: number;
  spentCents: number | null;
  planCents: number | null;
};

export type MonthPace = {
  month: string;
  daysInMonth: number;
  today: number;
  planTotalCents: number | null;
  days: MonthPaceDay[];
};

export type MonthPaceInput = {
  month: string;
  daysInMonth: number;
  today: number;
  spentByDay: Record<number, number>;
  planTotalCents: number | null;
  fixedByDay: Record<number, number>;
};

export type ExpenseOccurrencesInput = {
  rules: RecurringRuleSnapshot[];
  month: { start: Date; end: Date };
  nextOccurrence: (date: Date, rule: RecurringRuleSnapshot) => Date;
  dayOf: (date: Date) => number;
};

const days = (count: number): number[] =>
  Array.from({ length: count }, (_, index) => index + 1);

export function expenseOccurrencesByDay({
  rules,
  month,
  nextOccurrence,
  dayOf,
}: ExpenseOccurrencesInput): Record<number, number> {
  const byDay: Record<number, number> = {};

  for (const rule of rules.filter(({ type }) => type === 'EXPENSE')) {
    let cursor = rule.startDate;

    while (cursor.getTime() <= month.end.getTime()) {
      if (rule.endDate && cursor.getTime() > rule.endDate.getTime()) break;
      if (cursor.getTime() >= month.start.getTime()) {
        const day = dayOf(cursor);
        byDay[day] = (byDay[day] ?? 0) + rule.amount;
      }
      cursor = nextOccurrence(cursor, rule);
    }
  }

  return byDay;
}

function cumulativeSpent(input: MonthPaceInput): Array<number | null> {
  const { today, daysInMonth, spentByDay } = input;
  const perDay = new Array<number>(daysInMonth + 1).fill(0);

  for (const [key, amount] of Object.entries(spentByDay)) {
    perDay[Math.min(Number(key), Math.max(today, 1))] += amount;
  }

  let total = 0;
  return days(daysInMonth).map((day) => {
    if (day > today) return null;
    total += perDay[day];
    return total;
  });
}

function cumulativePlan(
  input: MonthPaceInput,
  planTotalCents: number,
): number[] {
  const { daysInMonth, fixedByDay } = input;
  let fixedLeft = planTotalCents;
  const fixed = days(daysInMonth).map((day) => {
    const amount = Math.min(fixedByDay[day] ?? 0, fixedLeft);
    fixedLeft -= amount;
    return amount;
  });
  const variableTotal = fixedLeft;
  const variableShare = Math.floor(variableTotal / daysInMonth);
  const remainder = variableTotal - variableShare * daysInMonth;

  let total = 0;
  return days(daysInMonth).map((day) => {
    total += fixed[day - 1] + variableShare;
    if (day === daysInMonth) total += remainder;
    return total;
  });
}

export function buildMonthPace(input: MonthPaceInput): MonthPace {
  const { month, daysInMonth, today, planTotalCents } = input;
  const spent = cumulativeSpent(input);
  const plan =
    planTotalCents === null ? null : cumulativePlan(input, planTotalCents);

  return {
    month,
    daysInMonth,
    today,
    planTotalCents,
    days: days(daysInMonth).map((day) => ({
      day,
      spentCents: spent[day - 1],
      planCents: plan === null ? null : plan[day - 1],
    })),
  };
}
