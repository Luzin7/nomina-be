import {
  AccountNotFoundError,
  AutopayConfigurationError,
  AutopayInvalidSourceAccountError,
  AutopayRequiresCreditCardError,
} from '@modules/account/errors';
import { AccountRepository } from '@modules/account/repositories/contracts/AccountRepository';
import {
  makeCashAccount,
  makeCheckingAccount,
  makeCreditCard,
} from '@modules/account/test-helpers/mock-factories';
import { DateProvider } from '@providers/date/contracts/DateProvider';
import { CreditCard } from '@modules/account/entities/CreditCardAccount';
import { SetAutopayService } from './set-autopay.service';

const FIRST_ENABLE = new Date('2026-11-01T10:00:00Z');
const SECOND_ENABLE = new Date('2026-12-01T10:00:00Z');

function makeRequest(overrides = {}) {
  return {
    accountId: 'card-1',
    workspaceId: 'ws-1',
    enabled: true,
    sourceAccountId: 'src-1',
    ...overrides,
  };
}

describe('SetAutopayService', () => {
  let service: SetAutopayService;
  let accountRepository: jest.Mocked<AccountRepository>;
  let dateProvider: jest.Mocked<DateProvider>;

  beforeEach(() => {
    accountRepository = {
      findById: jest.fn(),
      updateAutoPay: jest.fn(),
    } as unknown as jest.Mocked<AccountRepository>;
    dateProvider = { now: jest.fn() } as unknown as jest.Mocked<DateProvider>;
    dateProvider.now.mockReturnValue(FIRST_ENABLE);
    service = new SetAutopayService(accountRepository, dateProvider);
  });

  function givenAccounts(...accounts: Array<{ id: string }>) {
    accountRepository.findById.mockImplementation(
      async (id) => (accounts.find((a) => a.id === id) as never) ?? null,
    );
  }

  const card = () => makeCreditCard({ id: 'card-1' });
  const checking = (overrides = {}) =>
    makeCheckingAccount({ id: 'src-1', ...overrides });

  it('returns AccountNotFoundError when the account does not exist', async () => {
    givenAccounts();

    const result = await service.execute(makeRequest());

    expect(result.value).toBeInstanceOf(AccountNotFoundError);
  });

  it('returns AccountNotFoundError for an account of another workspace', async () => {
    givenAccounts(makeCreditCard({ id: 'card-1', workspaceId: 'other-ws' }));

    const result = await service.execute(makeRequest());

    expect(result.value).toBeInstanceOf(AccountNotFoundError);
    expect(accountRepository.updateAutoPay).not.toHaveBeenCalled();
  });

  it('returns AutopayRequiresCreditCardError for a non-card account', async () => {
    givenAccounts(makeCheckingAccount({ id: 'card-1' }));

    const result = await service.execute(makeRequest());

    expect(result.value).toBeInstanceOf(AutopayRequiresCreditCardError);
  });

  it('returns AutopayConfigurationError when no source is given or stored', async () => {
    givenAccounts(card());

    const result = await service.execute(
      makeRequest({ sourceAccountId: undefined }),
    );

    expect(result.value).toBeInstanceOf(AutopayConfigurationError);
    expect(accountRepository.updateAutoPay).not.toHaveBeenCalled();
  });

  it.each([
    ['dueDay', { dueDay: 0 }],
    ['closingDaysBeforeDue', { closingDaysBeforeDue: 0 }],
  ])(
    'returns AutopayConfigurationError when %s is invalid',
    async (_field, override) => {
      givenAccounts(
        CreditCard.reconstitute(
          {
            workspaceId: 'ws-1',
            name: 'My Card',
            timezone: 'UTC',
            balance: 0n,
            creditLimit: 500000n,
            closingDaysBeforeDue: 5,
            dueDay: 15,
            autoPayEnabled: false,
            autoPayConfirmedAt: null,
            autoPayEnabledAt: null,
            autoPaySourceAccountId: null,
            ...override,
          },
          'card-1',
        ),
        checking(),
      );

      const result = await service.execute(makeRequest());

      expect(result.value).toBeInstanceOf(AutopayConfigurationError);
      expect(accountRepository.updateAutoPay).not.toHaveBeenCalled();
    },
  );

  it.each([
    ['source of another workspace', checking({ workspaceId: 'other-ws' })],
    ['source that is a credit card', makeCreditCard({ id: 'src-1' })],
  ])('returns AutopayInvalidSourceAccountError for %s', async (_n, source) => {
    givenAccounts(card(), source);

    const result = await service.execute(makeRequest());

    expect(result.value).toBeInstanceOf(AutopayInvalidSourceAccountError);
    expect(accountRepository.updateAutoPay).not.toHaveBeenCalled();
  });

  it('returns AutopayInvalidSourceAccountError when the source is the card itself', async () => {
    givenAccounts(card());

    const result = await service.execute(
      makeRequest({ sourceAccountId: 'card-1' }),
    );

    expect(result.value).toBeInstanceOf(AutopayInvalidSourceAccountError);
  });

  it('returns AutopayInvalidSourceAccountError when the source does not exist', async () => {
    givenAccounts(card());

    const result = await service.execute(makeRequest());

    expect(result.value).toBeInstanceOf(AutopayInvalidSourceAccountError);
  });

  it('accepts a cash account as source', async () => {
    givenAccounts(card(), makeCashAccount({ id: 'src-1' }));

    const result = await service.execute(makeRequest());

    expect(result.isRight()).toBe(true);
  });

  it('enables, stores the source and sets confirmedAt on first enable', async () => {
    const target = card();
    givenAccounts(target, checking());

    const result = await service.execute(makeRequest());

    expect(result.isRight()).toBe(true);
    expect(target.autoPayEnabled).toBe(true);
    expect(target.autoPaySourceAccountId).toBe('src-1');
    expect(target.autoPayConfirmedAt).toEqual(FIRST_ENABLE);
    expect(accountRepository.updateAutoPay).toHaveBeenCalledWith(target);
  });

  it('keeps confirmedAt on disable and on re-enable', async () => {
    const target = card();
    givenAccounts(target, checking());
    await service.execute(makeRequest());

    await service.execute(makeRequest({ enabled: false }));
    expect(target.autoPayEnabled).toBe(false);
    expect(target.autoPayConfirmedAt).toEqual(FIRST_ENABLE);

    dateProvider.now.mockReturnValue(SECOND_ENABLE);
    await service.execute(makeRequest({ sourceAccountId: undefined }));

    expect(target.autoPayEnabled).toBe(true);
    expect(target.autoPayConfirmedAt).toEqual(FIRST_ENABLE);
    expect(target.autoPaySourceAccountId).toBe('src-1');
  });

  it('sets enabledAt on every enable and keeps it on disable', async () => {
    const target = card();
    givenAccounts(target, checking());

    await service.execute(makeRequest());
    expect(target.autoPayEnabledAt).toEqual(FIRST_ENABLE);

    dateProvider.now.mockReturnValue(SECOND_ENABLE);
    await service.execute(makeRequest({ enabled: false }));
    expect(target.autoPayEnabledAt).toEqual(FIRST_ENABLE);

    await service.execute(makeRequest({ sourceAccountId: undefined }));
    expect(target.autoPayEnabledAt).toEqual(SECOND_ENABLE);
    expect(target.autoPayConfirmedAt).toEqual(FIRST_ENABLE);
  });
});
