import { CardCyclePeriodRecord } from '@modules/card-cycle/repositories/contracts/CardCycleRepository';
import { CardCycleStatusResponse } from '../features/get-card-cycle-status/get-card-cycle-status.handler';
import { SaveCardCycleBudgetResponse } from '../features/save-card-cycle-budget/save-card-cycle-budget.handler';

export class CardCyclePresenter {
  static toStatus(response: CardCycleStatusResponse) {
    return {
      accountId: response.accountId,
      dueDate: response.dueDate,
      periodStart: response.periodStart,
      periodEnd: response.periodEnd,
      limitCents: response.limitCents,
      cycleSpendCents: response.cycleSpendCents,
      availableCents: response.availableCents,
      materializedAt: response.materializedAt.toISOString(),
    };
  }

  static toLimit(response: SaveCardCycleBudgetResponse) {
    return {
      accountId: response.accountId,
      effectiveFrom: response.effectiveFrom,
      limitCents: response.limitCents,
    };
  }

  static toPeriods(periods: CardCyclePeriodRecord[]) {
    return periods.map((period) => ({
      dueDate: period.dueDate,
      periodStart: period.periodStart,
      periodEnd: period.periodEnd,
      dueDay: period.dueDay,
      closingDaysBeforeDue: period.closingDaysBeforeDue,
      materializedAt: period.materializedAt.toISOString(),
    }));
  }
}
