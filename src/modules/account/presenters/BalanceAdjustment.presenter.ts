import { BalanceAdjustmentRecord } from '@modules/account/repositories/contracts/AccountRepository';

export class BalanceAdjustmentPresenter {
  static toHTTP(adjustment: BalanceAdjustmentRecord) {
    return {
      id: adjustment.id,
      fromCents: adjustment.expectedBalanceCents,
      toCents: adjustment.targetBalanceCents,
      deltaCents: adjustment.deltaCents,
      createdAt: adjustment.createdAt.toISOString(),
    };
  }
}
