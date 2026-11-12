import { AccountType } from '@constants/enums';
import * as schema from '@infra/databases/drizzle/schema';
import { CreditCard } from '@modules/account/entities/CreditCardAccount';
import { AccountMapper } from './account.mapper';

type AccountRow = typeof schema.accounts.$inferSelect;

function makeCreditCardRow(overrides: Partial<AccountRow> = {}): AccountRow {
  return {
    id: 'acc-1',
    workspaceId: 'ws-1',
    name: 'Legacy Card',
    type: AccountType.CREDIT_CARD,
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

describe('AccountMapper credit card without a configured cycle', () => {
  it('maps a null dueDay without throwing', () => {
    const account = AccountMapper.toDomain(makeCreditCardRow());

    expect(account).toBeInstanceOf(CreditCard);
    expect((account as CreditCard).dueDay).toBeNull();
  });

  it('writes a null dueDay back unchanged on update', () => {
    const card = AccountMapper.toDomain(makeCreditCardRow()) as CreditCard;

    expect(AccountMapper.toUpdatePayload(card).dueDay).toBeNull();
  });

  it('writes a null dueDay back unchanged on insert', () => {
    const card = AccountMapper.toDomain(makeCreditCardRow()) as CreditCard;

    expect(AccountMapper.toDatabase(card).dueDay).toBeNull();
  });

  it('maps a configured dueDay', () => {
    const card = AccountMapper.toDomain(
      makeCreditCardRow({ dueDay: 12 }),
    ) as CreditCard;

    expect(card.dueDay).toBe(12);
  });
});
