import { AccountType } from '@constants/enums';
import { CashAccount } from './CashAccounts';
import { CheckingAccount } from './CheckingAccount';
import { CreditCard } from './CreditCardAccount';
import { InvestmentAccount } from './InvestmentAccount';
import { AnyAccount } from './types';

const base = {
  workspaceId: 'ws-1',
  name: 'Conta',
  timezone: 'America/Sao_Paulo',
};

function unwrap(result: { isLeft(): boolean; value: unknown }): AnyAccount {
  if (result.isLeft()) throw result.value;
  return result.value as AnyAccount;
}

describe('canAdjustBalance', () => {
  it.each([
    [
      'CHECKING',
      () =>
        unwrap(CheckingAccount.create({ ...base, type: AccountType.CHECKING })),
      true,
    ],
    ['CASH', () => unwrap(CashAccount.create(base)), true],
    ['INVESTMENT', () => unwrap(InvestmentAccount.create(base)), true],
    [
      'CREDIT_CARD',
      () =>
        unwrap(
          CreditCard.create({
            ...base,
            creditLimit: 100000n,
            closingDaysBeforeDue: 5,
            dueDay: 15,
          }),
        ),
      false,
    ],
  ])('%s', (_type, build, expected) => {
    expect(build().canAdjustBalance()).toBe(expected);
  });
});
