import { AccountType } from '@constants/enums';
import { CheckingAccount } from '@modules/account/entities/CheckingAccount';
import {
  makeCashAccount,
  makeCreditCard,
} from '../test-helpers/mock-factories';
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

describe('AccountPresenter', () => {
  it('serializes credit card autopay fields when disabled', () => {
    const card = makeCreditCard();

    const payload = AccountPresenter.toHTTP(card);

    expect(payload).toMatchObject({
      autoPayEnabled: false,
      autoPaySourceAccountId: null,
      autoPayConfirmedAt: null,
    });
  });

  it('serializes credit card autopay fields when enabled', () => {
    const card = makeCreditCard();
    const confirmedAt = new Date('2026-11-01T10:00:00Z');
    card.enableAutoPay('src-1', confirmedAt);

    const payload = AccountPresenter.toHTTP(card);

    expect(payload).toMatchObject({
      autoPayEnabled: true,
      autoPaySourceAccountId: 'src-1',
      autoPayConfirmedAt: '2026-11-01T10:00:00.000Z',
    });
  });

  it('does not expose autopay fields on non-card accounts', () => {
    const payload = AccountPresenter.toHTTP(makeCashAccount());

    expect(payload).not.toHaveProperty('autoPayEnabled');
  });

  it('serializes the autopay response shape', () => {
    const card = makeCreditCard({ id: 'card-1' });
    card.enableAutoPay('src-1', new Date('2026-11-01T10:00:00Z'));

    expect(AccountPresenter.toAutopayHTTP(card)).toEqual({
      accountId: 'card-1',
      autoPayEnabled: true,
      autoPayConfirmedAt: '2026-11-01T10:00:00.000Z',
      autoPaySourceAccountId: 'src-1',
    });
  });
});
