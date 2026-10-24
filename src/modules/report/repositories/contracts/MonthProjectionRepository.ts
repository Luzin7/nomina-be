import {
  LedgerMonth,
  RecurringRuleSnapshot,
} from '@modules/report/valueObjects/MonthProjection';

export type DateRange = { start: Date; end: Date };

export type MonthLedgerQuery = {
  workspaceId: string;
  timezone: string;
  range: DateRange;
  currentMonthStart: Date;
};

export abstract class MonthProjectionRepository {
  abstract findMonthLedger(query: MonthLedgerQuery): Promise<LedgerMonth[]>;

  abstract findActiveRecurringRules(
    workspaceId: string,
    month: DateRange,
  ): Promise<RecurringRuleSnapshot[]>;
}
