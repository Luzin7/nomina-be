import { PeriodTotals } from '@modules/report/valueObjects/MonthSummary';
import { RecurringRuleSnapshot } from '@modules/report/valueObjects/MonthProjection';

export type DateRange = { start: Date; end: Date };

export type ProjectionTotalsQuery = {
  workspaceId: string;
  currentMonth: DateRange;
  today: DateRange;
  basisMonths: DateRange[];
};

export type ProjectionTotals = {
  scheduled: PeriodTotals;
  variableExpenseToday: number;
  basisMonths: Array<{ totalExpense: number; variableExpense: number }>;
  firstActivityAt: Date | null;
};

export abstract class MonthProjectionRepository {
  abstract sumProjectionTotals(
    query: ProjectionTotalsQuery,
  ): Promise<ProjectionTotals>;

  abstract findActiveRecurringRules(
    workspaceId: string,
    month: DateRange,
  ): Promise<RecurringRuleSnapshot[]>;
}
