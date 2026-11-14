import {
  LedgerMonth,
  RecurringRuleSnapshot,
} from '@modules/report/valueObjects/MonthProjection';
import type { PendingInstallment } from '@modules/report/valueObjects/ProjectionHorizon';

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

  abstract findPendingInstallments(
    workspaceId: string,
    range: DateRange,
  ): Promise<PendingInstallment[]>;
}
