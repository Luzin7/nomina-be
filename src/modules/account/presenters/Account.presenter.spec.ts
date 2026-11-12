import { AccountType } from '@constants/enums';
import { CheckingAccount } from '@modules/account/entities/CheckingAccount';
import { AccountPresenter } from './Account.presenter';

function makeChecking() {
  const result = CheckingAccount.create(
    {
      workspaceId: 'ws-1',
      name: 'Checking',
      type: AccountType.CHECKING,
      timezone: 'America/Sao_Paulo',
      balance: 12_345n,
    },
    'acc-1',
  );
  if (result.isLeft()) throw result.value;
  return result.value;
}

describe('AccountPresenter.toListItemHTTP', () => {
  it('serializes balanceUpdatedAt as an ISO string', () => {
    const payload = AccountPresenter.toListItemHTTP({
      account: makeChecking(),
      balanceUpdatedAt: new Date('2026-03-04T05:06:07.000Z'),
    });

    expect(payload).toEqual({
      ...AccountPresenter.toHTTP(makeChecking()),
      balanceUpdatedAt: '2026-03-04T05:06:07.000Z',
    });
  });

  it('serializes balanceUpdatedAt as null when the account has no movement', () => {
    const payload = AccountPresenter.toListItemHTTP({
      account: makeChecking(),
      balanceUpdatedAt: null,
    });

    expect(payload.balanceUpdatedAt).toBeNull();
  });
});
