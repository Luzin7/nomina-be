import { HorizonProjection } from '@modules/report/valueObjects/ProjectionHorizon';
import { MoneyUtils } from '@utils/MoneyUtils';

type Response = {
  projection: HorizonProjection;
  horizon: number;
  generatedAt: Date;
};

const toDecimal = (cents: number) => MoneyUtils.centsToDecimal(cents);

const toHTTPPeriodTotals = (totals: {
  totalIncome: number;
  totalExpense: number;
}) => ({
  totalIncome: toDecimal(totals.totalIncome),
  totalExpense: toDecimal(totals.totalExpense),
});

export function toHTTPProjectionHorizon({
  projection,
  horizon,
  generatedAt,
}: Response) {
  return {
    openingBalance: toDecimal(projection.openingBalanceCents),
    generatedAt: generatedAt.toISOString(),
    horizon,
    months: projection.months.map((month) => ({
      key: month.key,
      status: month.status,
      inflow: toDecimal(month.inflowCents),
      outflow: toDecimal(month.outflowCents),
      net: toDecimal(month.netCents),
      shortfall: toDecimal(month.shortfallCents),
      endBalance: toDecimal(month.endBalanceCents),
      sources: {
        realized: toHTTPPeriodTotals(month.sources.realized),
        scheduled: toHTTPPeriodTotals(month.sources.scheduled),
        recurringNotYetGenerated: toHTTPPeriodTotals(
          month.sources.recurringNotYetGenerated,
        ),
        fixedBillsDue: toDecimal(month.sources.fixedBillsDueCents),
        variableRemaining: toDecimal(month.sources.variableRemainingCents),
      },
      pendingInstallments: month.pendingInstallments.map((installment) => ({
        date: installment.date,
        amount: toDecimal(installment.amountCents),
        type: installment.type,
        recurringId: installment.recurringId,
        installmentNumber: installment.installmentNumber,
        installmentCount: installment.installmentCount,
      })),
      plan: month.plan.exists
        ? {
            exists: true,
            monthlyIncome:
              month.plan.monthlyIncomeCents === null
                ? null
                : toDecimal(month.plan.monthlyIncomeCents),
            target: toDecimal(month.plan.targetCents),
            mode: month.plan.mode,
          }
        : { exists: false },
      hasHistory: month.hasHistory,
      basisMonths: month.basisMonths,
    })),
  };
}
