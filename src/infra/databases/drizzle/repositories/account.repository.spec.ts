import { AccountType } from '@constants/enums';
import { DrizzleService } from '@infra/databases/drizzle/drizzle.service';
import * as schema from '@infra/databases/drizzle/schema';
import { CheckingAccount } from '@modules/account/entities/CheckingAccount';
import { CreditCard } from '@modules/account/entities/CreditCardAccount';
import { AccountRepositoryImplementation } from './account.repository';

type AccountRow = typeof schema.accounts.$inferSelect;

function makeRow(overrides: Partial<AccountRow> = {}): AccountRow {
  return {
    id: 'acc-1',
    workspaceId: 'ws-1',
    name: 'Old Name',
    type: AccountType.CHECKING,
    balance: 10_000,
    timezone: 'America/Sao_Paulo',
    closingDaysBeforeDue: 7,
    dueDay: null,
    creditLimit: null,
    autoPayEnabled: false,
    autoPayConfirmedAt: null,
    autoPaySourceAccountId: null,
    ...overrides,
  };
}

function makeCheckingAccount(): CheckingAccount {
  const result = CheckingAccount.create(
    {
      workspaceId: 'ws-1',
      name: 'New Name',
      timezone: 'America/Sao_Paulo',
      type: AccountType.CHECKING,
      balance: 99_999n,
    },
    'acc-1',
  );
  if (result.isLeft()) throw result.value;
  return result.value;
}

function makeCreditCard(): CreditCard {
  const result = CreditCard.create(
    {
      workspaceId: 'ws-1',
      name: 'New Name',
      timezone: 'America/Sao_Paulo',
      creditLimit: 900_000n,
      closingDaysBeforeDue: 5,
      dueDay: 15,
      balance: 99_999n,
    },
    'acc-1',
  );
  if (result.isLeft()) throw result.value;
  return result.value;
}

function makeRepository(returnedRow: AccountRow) {
  const where = jest.fn().mockReturnValue({
    returning: jest.fn().mockResolvedValue([returnedRow]),
  });
  const set = jest.fn().mockReturnValue({ where });
  const update = jest.fn().mockReturnValue({ set });

  const drizzle = {
    db: { update },
  } as unknown as DrizzleService;

  return {
    repository: new AccountRepositoryImplementation(drizzle),
    set,
    where,
  };
}

describe('AccountRepositoryImplementation.update', () => {
  it('writes only editable columns for a checking account', async () => {
    const { repository, set } = makeRepository(makeRow());

    await repository.update(makeCheckingAccount());

    expect(set.mock.calls[0][0]).toEqual({ name: 'New Name' });
    expect(set.mock.calls[0][0]).not.toHaveProperty('balance');
  });

  it('writes only editable columns for a credit card', async () => {
    const { repository, set } = makeRepository(
      makeRow({ type: AccountType.CREDIT_CARD, dueDay: 20 }),
    );

    await repository.update(makeCreditCard());

    expect(Object.keys(set.mock.calls[0][0]).sort()).toEqual([
      'closingDaysBeforeDue',
      'creditLimit',
      'dueDay',
      'name',
    ]);
    expect(set.mock.calls[0][0]).not.toHaveProperty('balance');
  });
});

describe('AccountRepositoryImplementation autopay persistence', () => {
  function makeEnabledCard() {
    const card = makeCreditCard();
    card.enableAutoPay('src-1', new Date('2026-11-01T10:00:00Z'));
    return card;
  }

  it('general update never writes autopay columns', async () => {
    const { repository, set } = makeRepository(
      makeRow({ type: AccountType.CREDIT_CARD, dueDay: 20 }),
    );

    await repository.update(makeEnabledCard());

    const keys = Object.keys(set.mock.calls[0][0]);
    expect(keys.filter((key) => key.startsWith('autoPay'))).toEqual([]);
  });

  it('updateAutoPay writes only the three autopay columns', async () => {
    const { repository, set, where } = makeRepository(makeRow());

    await repository.updateAutoPay(makeEnabledCard());

    expect(set.mock.calls[0][0]).toEqual({
      autoPayEnabled: true,
      autoPayConfirmedAt: new Date('2026-11-01T10:00:00Z'),
      autoPaySourceAccountId: 'src-1',
    });
    expect(where).toHaveBeenCalledTimes(1);
  });
});
