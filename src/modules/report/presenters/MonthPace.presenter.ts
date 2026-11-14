import { MonthPace } from '@modules/report/valueObjects/MonthPace';

export class MonthPacePresenter {
  static toHTTP(pace: MonthPace) {
    return {
      month: pace.month,
      daysInMonth: pace.daysInMonth,
      today: pace.today,
      planTotalCents: pace.planTotalCents,
      planSource: pace.planSource,
      days: pace.days.map(({ day, spentCents, planCents }) => ({
        day,
        spentCents,
        planCents,
      })),
    };
  }
}
