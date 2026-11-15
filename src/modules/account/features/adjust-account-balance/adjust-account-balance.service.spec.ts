import { ledgerGenerationKey } from '@shared/cache/report-cache';
import { AccountType } from '@constants/enums';
import { CacheProvider } from '@infra/cache/contracts/CacheProvider';
import { CheckingAccount } from '@modules/account/entities/CheckingAccount';
import { CreditCard } from '@modules/account/entities/CreditCardAccount';
import { AnyAccount } from '@modules/account/entities/types';
import {
  AccountNotAdjustableError,
  AccountNotFoundError,
  BalanceChangedSinceReadError,
  IdempotencyKeyReusedError,
} from '@modules/account/errors';
import {
  AccountRepository,
  BalanceAdjustmentRecord,
} from '@modules/account/repositories/contracts/AccountRepository';
import { UnauthorizedError } from '@shared/errors/UnauthorizedError';
import { AdjustAccountBalanceService } from './adjust-account-balance.service';

const ADJUSTMENT: BalanceAdjustmentRecord = {
  id: 'adj-1',
  accountId: 'acc-1',
  expectedBalanceCents: 1000,
  targetBalanceCents: 1500,
  deltaCents: 500,
  movementSeq: 7,
  createdAt: new Date('2026-11-15T12:00:00.000Z'),
};

function makeRequest(overrides = {}) {
  return {
    id: 'adj-1',
    accountId: 'acc-1',
    workspaceId: 'ws-1',
    sub: 'user-1',
    expectedBalanceCents: 1000,
    targetBalanceCents: 1500,
    ...overrides,
  };
}

function makeChecking(workspaceId = 'ws-1'): AnyAccount {
  const result = CheckingAccount.create(
    {
      workspaceId,
      name: 'Conta',
      type: AccountType.CHECKING,
      timezone: 'America/Sao_Paulo',
    },
    'acc-1',
  );
  if (result.isLeft()) throw result.value;
  return result.value;
}

function makeCard(): AnyAccount {
  const result = CreditCard.create(
    {
      workspaceId: 'ws-1',
      name: 'Cartão',
      creditLimit: 100000n,
      closingDaysBeforeDue: 5,
      dueDay: 15,
      timezone: 'America/Sao_Paulo',
    },
    'acc-1',
  );
  if (result.isLeft()) throw result.value;
  return result.value;
}

describe('AdjustAccountBalanceService', () => {
  let service: AdjustAccountBalanceService;
  let accountRepository: jest.Mocked<
    Pick<AccountRepository, 'findById' | 'adjustBalance'>
  >;
  let cache: jest.Mocked<
    Pick<CacheProvider, 'delByPattern' | 'incrementCounter'>
  >;

  beforeEach(() => {
    accountRepository = {
      findById: jest.fn().mockResolvedValue(makeChecking()),
      adjustBalance: jest
        .fn()
        .mockResolvedValue({ status: 'applied', adjustment: ADJUSTMENT }),
    };
    cache = {
      delByPattern: jest.fn().mockResolvedValue(0),
      incrementCounter: jest.fn().mockResolvedValue(1),
    };
    service = new AdjustAccountBalanceService(
      accountRepository as unknown as AccountRepository,
      cache as unknown as CacheProvider,
    );
  });

  it('returns the adjustment and invalidates ledger and goal reads when applied', async () => {
    const result = await service.execute(makeRequest());

    expect(result.isRight() && result.value).toEqual({
      adjusted: true,
      adjustment: ADJUSTMENT,
    });
    expect(accountRepository.adjustBalance).toHaveBeenCalledWith({
      id: 'adj-1',
      accountId: 'acc-1',
      workspaceId: 'ws-1',
      actorId: 'user-1',
      expectedBalanceCents: 1000,
      targetBalanceCents: 1500,
    });
    expect(cache.incrementCounter).toHaveBeenCalledWith(
      ledgerGenerationKey('ws-1'),
      expect.anything(),
    );
    expect(cache.incrementCounter).toHaveBeenCalledWith(
      'cache-gen:goal:ws-1',
      expect.anything(),
    );
  });

  it('returns the stored adjustment and invalidates when replayed', async () => {
    accountRepository.adjustBalance.mockResolvedValue({
      status: 'replayed',
      adjustment: ADJUSTMENT,
    });

    const result = await service.execute(makeRequest());

    expect(result.isRight() && result.value).toEqual({
      adjusted: true,
      adjustment: ADJUSTMENT,
    });
    expect(cache.incrementCounter).toHaveBeenCalledTimes(2);
  });

  it('returns adjusted false without invalidating when unchanged', async () => {
    accountRepository.adjustBalance.mockResolvedValue({ status: 'unchanged' });

    const result = await service.execute(makeRequest());

    expect(result.isRight() && result.value).toEqual({
      adjusted: false,
      adjustment: null,
    });
    expect(cache.incrementCounter).not.toHaveBeenCalled();
  });

  it('rejects an unknown account before the transaction', async () => {
    accountRepository.findById.mockResolvedValue(null);

    const result = await service.execute(makeRequest());

    expect(result.isLeft() && result.value).toBeInstanceOf(
      AccountNotFoundError,
    );
    expect(accountRepository.adjustBalance).not.toHaveBeenCalled();
  });

  it('rejects an account of another workspace before the transaction', async () => {
    accountRepository.findById.mockResolvedValue(makeChecking('ws-2'));

    const result = await service.execute(makeRequest());

    expect(result.isLeft() && result.value).toBeInstanceOf(UnauthorizedError);
    expect(accountRepository.adjustBalance).not.toHaveBeenCalled();
  });

  it('rejects a credit card before the transaction', async () => {
    accountRepository.findById.mockResolvedValue(makeCard());

    const result = await service.execute(makeRequest());

    expect(result.isLeft() && result.value).toBeInstanceOf(
      AccountNotAdjustableError,
    );
    expect(accountRepository.adjustBalance).not.toHaveBeenCalled();
  });

  it.each([
    ['account-not-found', AccountNotFoundError],
    ['key-reused', IdempotencyKeyReusedError],
    ['balance-changed', BalanceChangedSinceReadError],
  ] as const)(
    'maps %s to its named error without invalidating',
    async (status, ErrorClass) => {
      accountRepository.adjustBalance.mockResolvedValue({ status });

      const result = await service.execute(makeRequest());

      expect(result.isLeft() && result.value).toBeInstanceOf(ErrorClass);
      expect(cache.incrementCounter).not.toHaveBeenCalled();
    },
  );

  it('uses the exact copy for a stale expected balance', () => {
    expect(new BalanceChangedSinceReadError().message).toBe(
      'O saldo mudou desde que você abriu. Confira e tente de novo.',
    );
  });
});
