import { MonthPace } from '@modules/report/valueObjects/MonthPace';

export class MonthPacePresenter {
  static toHTTP(pace: MonthPace) {
    return {
      month: pace.month,
      daysInMonth: pace.daysInMonth,
      today: pace.today,
      planTotalCents: pace.planTotalCents,
      planSource: pace.planSource,
      controlledPlanTotalCents: pace.controlledPlanTotalCents,
      days: pace.days.map(
        ({
          day,
          spentCents,
          planCents,
          controlledSpentCents,
          controlledPlanCents,
        }) => ({
          day,
          spentCents,
          planCents,
          controlledSpentCents,
          controlledPlanCents,
        }),
      ),
    };
  }
}
