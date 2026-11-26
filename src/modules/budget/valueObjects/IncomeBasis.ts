import {
  inferIncome,
  type IncomeInference,
} from '@modules/budget/valueObjects/IncomeInference';
import { selectBasisMonths } from '@modules/report/valueObjects/MonthProjection';
import {
  LOOKBACK_MONTHS,
  type LedgerMonth,
} from '@modules/report/valueObjects/ProjectionRules';
import { DateProvider } from '@providers/date/contracts/DateProvider';

export type IncomeBasisTotals = {
  month: string;
  incomeCents: number;
  expenseByCategory: Record<string, number>;
};

export type IncomeBasis = {
  months: IncomeBasisTotals[];
  inference: IncomeInference | null;
};

export type LookbackRange = {
  start: Date;
  end: Date;
};

export function resolveIncomeBasis(
  ledger: LedgerMonth[],
  totals: IncomeBasisTotals[],
  currentMonth: string,
): IncomeBasis {
  const totalsByMonth = new Map(totals.map((entry) => [entry.month, entry]));
  const months = selectBasisMonths(ledger, currentMonth).map(({ key }) => ({
    month: key,
    incomeCents: totalsByMonth.get(key)?.incomeCents ?? 0,
    expenseByCategory: totalsByMonth.get(key)?.expenseByCategory ?? {},
  }));

  return {
    months,
    inference: inferIncome(months.map((month) => month.incomeCents)),
  };
}

export function lookbackRange(
  dateProvider: DateProvider,
  currentMonthStart: Date,
  timezone: string,
): LookbackRange {
  const start = dateProvider.startOfMonth(
    dateProvider.add(currentMonthStart, -LOOKBACK_MONTHS, 'month', timezone),
    timezone,
  );
  const previousMonth = dateProvider.add(
    currentMonthStart,
    -1,
    'month',
    timezone,
  );

  return { start, end: dateProvider.endOfMonth(previousMonth, timezone) };
}
