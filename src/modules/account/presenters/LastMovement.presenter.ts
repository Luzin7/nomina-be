import { AccountLastMovement } from '@modules/account/repositories/contracts/AccountRepository';
import { MoneyUtils } from '@utils/MoneyUtils';

export class LastMovementPresenter {
  static toHTTP(movement: AccountLastMovement) {
    return {
      accountId: movement.accountId,
      transactionId: movement.transactionId,
      title: movement.title,
      date: movement.date.toISOString(),
      amount: MoneyUtils.centsToDecimal(movement.amountCents),
      type: movement.type,
    };
  }
}
