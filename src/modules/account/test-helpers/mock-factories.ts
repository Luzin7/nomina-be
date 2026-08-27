import { AccountType } from '@constants/enums';
import { CheckingAccount } from '@modules/account/entities/CheckingAccount';
import { CreditCard } from '@modules/account/entities/CreditCardAccount';

export function makeCreditCard(
  overrides: Partial<Parameters<typeof CreditCard.create>[0]> & {
    id?: string;
  } = {},
): CreditCard {
  const { id, ...props } = overrides;
  const r = CreditCard.create(
    {
      workspaceId: 'ws-1',
      name: 'My Card',
      timezone: 'America/Sao_Paulo',
      creditLimit: 500000n,
      closingDaysBeforeDue: 5,
      dueDay: 15,
      ...props,
    },
    id ?? 'acc-1',
  );
  if (r.isLeft()) throw r.value;
  return r.value;
}

export function makeCheckingAccount(
  overrides: Partial<Parameters<typeof CheckingAccount.create>[0]> & {
    id?: string;
  } = {},
): CheckingAccount {
  const { id, ...props } = overrides;
  const r = CheckingAccount.create(
    {
      workspaceId: 'ws-1',
      name: 'Checking',
      timezone: 'UTC',
      type: AccountType.CHECKING,
      balance: 100000n,
      ...props,
    },
    id ?? 'acc-2',
  );
  if (r.isLeft()) throw r.value;
  return r.value;
}
