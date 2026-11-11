import { type BudgetMode } from '@constants/enums';
import { RECURRING_GENERATION_TIMEZONE } from '@constants/timezone';
import { projectMonthEnd } from '@modules/report/valueObjects/MonthProjection';
import type {
  MonthProjection,
  RecurringRuleSnapshot,
} from '@modules/report/valueObjects/MonthProjection';
import type { LedgerMonth } from '@modules/report/valueObjects/ProjectionRules';
import type { PeriodTotals } from '@modules/report/valueObjects/MonthSummary';
import { nextOccurrence } from '@utils/installmentSchedule';
import dayjs from 'dayjs';
import timezonePlugin from 'dayjs/plugin/timezone';
import utc from 'dayjs/plugin/utc';

dayjs.extend(utc);
dayjs.extend(timezonePlugin);

const MAX_OCCURRENCE_STEPS = 1000;

export type HorizonMonthWindow = {
  key: string;
  start: Date;
  end: Date;
  days: number;
};

export type PlanSnapshot = {
  monthlyIncomeCents: number;
  targetCents: number;
  mode: BudgetMode;
};

export type BudgetSnapshotResolution = {
  monthKey: string;
  snapshot: PlanSnapshot | null;
};

export type PendingInstallment = {
  date: Date;
  amount: number;
  type: 'INCOME' | 'EXPENSE';
  recurringId: string | null;
  installmentNumber: number | null;
  installmentCount: number | null;
};

export type HorizonMonthInstallment = {
  date: string;
  amountCents: number;
  type: 'INCOME' | 'EXPENSE';
  recurringId: string | null;
  installmentNumber: number | null;
  installmentCount: number | null;
};

export type HorizonBundle = {
  months: HorizonMonthWindow[];
  asOf: Date;
  timezone: string;
  openingBalanceCents: number;
  ledger: LedgerMonth[];
  recurringRules: RecurringRuleSnapshot[];
  pendingInstallments: PendingInstallment[];
  budgetSnapshots: BudgetSnapshotResolution[];
};

export type HorizonMonthPlan =
  | { exists: false }
  | {
      exists: true;
      monthlyIncomeCents: number;
      targetCents: number;
      mode: BudgetMode;
    };

export type HorizonMonth = {
  key: string;
  status: 'ok' | 'insufficient';
  inflowCents: number;
  outflowCents: number;
  netCents: number;
  shortfallCents: number;
  endBalanceCents: number;
  sources: {
    realized: PeriodTotals;
    scheduled: PeriodTotals;
    recurringNotYetGenerated: PeriodTotals;
    fixedBillsDueCents: number;
    variableRemainingCents: number;
  };
  pendingInstallments: HorizonMonthInstallment[];
  plan: HorizonMonthPlan;
  hasHistory: boolean;
  basisMonths: number;
};

export type HorizonProjection = {
  openingBalanceCents: number;
  months: HorizonMonth[];
};

type ProjectMonthRequest = {
  month: HorizonMonthWindow;
  asOf: Date;
  timezone: string;
  realized: PeriodTotals;
  ledger: LedgerMonth[];
  recurringRules: RecurringRuleSnapshot[];
};

const pureDateAdder = {
  add(
    date: Date,
    amount: number,
    unit: 'day' | 'month' | 'year',
    timezone: string,
  ): Date {
    return dayjs(date).tz(timezone).add(amount, unit).toDate();
  },
};

const stepOccurrence = (date: Date, rule: RecurringRuleSnapshot): Date =>
  nextOccurrence(
    {
      startDate: date,
      frequency: rule.frequency,
      interval: rule.interval,
      timezone: RECURRING_GENERATION_TIMEZONE,
    },
    pureDateAdder,
  );

const localMonthKey = (instant: Date, timezone: string): string =>
  dayjs(instant).tz(timezone).format('YYYY-MM');

const localDayOfMonth = (instant: Date, timezone: string): number =>
  Number(dayjs(instant).tz(timezone).format('D'));

const localDate = (instant: Date, timezone: string): string =>
  dayjs(instant).tz(timezone).format('YYYY-MM-DD');

const groupInstallmentsByMonth = (
  rows: PendingInstallment[],
  timezone: string,
): Map<string, HorizonMonthInstallment[]> => {
  const groups = new Map<string, HorizonMonthInstallment[]>();

  for (const row of rows) {
    const key = localMonthKey(row.date, timezone);
    const group = groups.get(key) ?? [];
    group.push({
      date: localDate(row.date, timezone),
      amountCents: row.amount,
      type: row.type,
      recurringId: row.recurringId,
      installmentNumber: row.installmentNumber,
      installmentCount: row.installmentCount,
    });
    groups.set(key, group);
  }

  return groups;
};

export const projectMonth = ({
  month,
  asOf,
  timezone,
  realized,
  ledger,
  recurringRules,
}: ProjectMonthRequest): MonthProjection =>
  projectMonthEnd({
    month,
    dayOfMonth:
      month.key === localMonthKey(asOf, timezone)
        ? localDayOfMonth(asOf, timezone)
        : 0,
    realized,
    ledger,
    recurringRules,
    nextOccurrence: stepOccurrence,
  });

const isWithinMonth = (date: Date, month: HorizonMonthWindow): boolean =>
  date.getTime() >= month.start.getTime() &&
  date.getTime() <= month.end.getTime();

const isMaterializedInMonth = (
  rule: RecurringRuleSnapshot,
  month: HorizonMonthWindow,
): boolean => rule.materializedDates.some((date) => isWithinMonth(date, month));

const ruleOccursInMonth = (
  rule: RecurringRuleSnapshot,
  month: HorizonMonthWindow,
): boolean => {
  if (isMaterializedInMonth(rule, month)) return true;

  let cursor = rule.startDate;

  for (let step = 0; step < MAX_OCCURRENCE_STEPS; step++) {
    if (cursor.getTime() > month.end.getTime()) return false;
    if (rule.endDate !== null && cursor.getTime() > rule.endDate.getTime()) {
      return false;
    }
    if (isWithinMonth(cursor, month)) return true;
    cursor = stepOccurrence(cursor, rule);
  }

  return false;
};

const hasLedgerActivity = (entry: LedgerMonth | undefined): boolean =>
  entry !== undefined &&
  (entry.totalIncome > 0 ||
    entry.totalExpense > 0 ||
    entry.pending.totalIncome > 0 ||
    entry.pending.totalExpense > 0);

const findLedgerMonth = (
  ledger: LedgerMonth[],
  key: string,
): LedgerMonth | undefined => ledger.find((entry) => entry.key === key);

const findPlan = (
  snapshots: BudgetSnapshotResolution[],
  key: string,
): PlanSnapshot | null =>
  snapshots.find((entry) => entry.monthKey === key)?.snapshot ?? null;

const toPlan = (snapshot: PlanSnapshot | null): HorizonMonthPlan =>
  snapshot === null
    ? { exists: false }
    : {
        exists: true,
        monthlyIncomeCents: snapshot.monthlyIncomeCents,
        targetCents: snapshot.targetCents,
        mode: snapshot.mode,
      };

type MonthSource = {
  month: HorizonMonthWindow;
  current: boolean;
  realized: PeriodTotals;
  ledgerEntry: LedgerMonth | undefined;
  installments: HorizonMonthInstallment[];
  plan: PlanSnapshot | null;
  projection: MonthProjection;
};

const isInsufficient = (
  source: MonthSource,
  recurringRules: RecurringRuleSnapshot[],
): boolean => {
  if (source.current) return false;
  if (source.projection.hasHistory) return false;
  if (hasLedgerActivity(source.ledgerEntry)) return false;
  if (source.plan !== null) return false;

  return !recurringRules.some((rule) => ruleOccursInMonth(rule, source.month));
};

const buildMonth = (
  source: MonthSource,
  recurringRules: RecurringRuleSnapshot[],
  endBalanceCents: number,
): HorizonMonth => {
  const { projection } = source;
  const inflowCents = projection.expectedIncome;
  const outflowCents = projection.expectedExpense;
  const netCents = inflowCents - outflowCents;
  const insufficient = isInsufficient(source, recurringRules);

  return {
    key: source.month.key,
    status: insufficient ? 'insufficient' : 'ok',
    inflowCents,
    outflowCents,
    netCents,
    shortfallCents: insufficient ? 0 : Math.max(0, -netCents),
    endBalanceCents,
    sources: {
      realized: source.realized,
      scheduled: projection.scheduled,
      recurringNotYetGenerated: projection.recurringNotYetGenerated,
      fixedBillsDueCents: projection.fixedBillsDue,
      variableRemainingCents: projection.variableRemaining,
    },
    pendingInstallments: source.installments,
    plan: toPlan(source.plan),
    hasHistory: projection.hasHistory,
    basisMonths: projection.basisMonths,
  };
};

const postAnchorDeltaCents = (
  projection: MonthProjection,
  realized: PeriodTotals,
): number =>
  projection.expectedIncome -
  realized.totalIncome -
  (projection.expectedExpense - realized.totalExpense);

export const projectHorizon = (bundle: HorizonBundle): HorizonProjection => {
  const currentMonthKey = localMonthKey(bundle.asOf, bundle.timezone);
  const installmentsByMonth = groupInstallmentsByMonth(
    bundle.pendingInstallments,
    bundle.timezone,
  );
  const months: HorizonMonth[] = [];
  let endBalanceCents = bundle.openingBalanceCents;

  for (const month of bundle.months) {
    const ledgerEntry = findLedgerMonth(bundle.ledger, month.key);
    const realized: PeriodTotals = {
      totalIncome: ledgerEntry?.totalIncome ?? 0,
      totalExpense: ledgerEntry?.totalExpense ?? 0,
    };
    const projection = projectMonth({
      month,
      asOf: bundle.asOf,
      timezone: bundle.timezone,
      realized,
      ledger: bundle.ledger,
      recurringRules: bundle.recurringRules,
    });

    endBalanceCents += postAnchorDeltaCents(projection, realized);
    months.push(
      buildMonth(
        {
          month,
          current: month.key === currentMonthKey,
          realized,
          ledgerEntry,
          installments: installmentsByMonth.get(month.key) ?? [],
          plan: findPlan(bundle.budgetSnapshots, month.key),
          projection,
        },
        bundle.recurringRules,
        endBalanceCents,
      ),
    );
  }

  return { openingBalanceCents: bundle.openingBalanceCents, months };
};
