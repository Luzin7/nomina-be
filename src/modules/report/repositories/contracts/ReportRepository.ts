export type SummaryRanges = {
  currentStart: Date;
  currentEnd: Date;
  prevStart: Date;
  prevEnd: Date;
  prevMtdEnd: Date;
};

export type SummaryMetrics = {
  currentMonthData: { totalIncome: number; totalExpense: number };
  previousMonthData: { totalIncome: number; totalExpense: number };
  previousMonthToDateData: { totalIncome: number; totalExpense: number };
};

export abstract class ReportRepository {
  abstract findMonthSummaryMetrics(
    workspaceId: string,
    ranges: SummaryRanges,
  ): Promise<SummaryMetrics>;
}
