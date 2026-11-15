import { AccountType } from '@constants/enums';
import { CheckingAccount } from '@modules/account/entities/CheckingAccount';
import {
  AccountRepository,
  BalanceAdjustmentRecord,
} from '@modules/account/repositories/contracts/AccountRepository';
import { AccountNotFoundError } from '@modules/account/errors';
import { UnauthorizedError } from '@shared/errors/UnauthorizedError';
import { ListBalanceAdjustmentsService } from './list-balance-adjustments.service';

const RECORD: BalanceAdjustmentRecord = {
  id: 'adj-1',
  accountId: 'acc-1',
  expectedBalanceCents: 1000,
  targetBalanceCents: 1500,
  deltaCents: 500,
  movementSeq: 7,
  createdAt: new Date('2026-11-15T12:00:00.000Z'),
};

function makeChecking(workspaceId = 'ws-1') {
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

describe('ListBalanceAdjustmentsService', () => {
  let service: ListBalanceAdjustmentsService;
  let accountRepository: jest.Mocked<
    Pick<AccountRepository, 'findById' | 'listBalanceAdjustments'>
  >;

  beforeEach(() => {
    accountRepository = {
      findById: jest.fn().mockResolvedValue(makeChecking()),
      listBalanceAdjustments: jest.fn().mockResolvedValue([RECORD]),
    };
    service = new ListBalanceAdjustmentsService(
      accountRepository as unknown as AccountRepository,
    );
  });

  it('lists the latest 20 adjustments of the account', async () => {
    const result = await service.execute({
      accountId: 'acc-1',
      workspaceId: 'ws-1',
    });

    expect(result.isRight() && result.value).toEqual([RECORD]);
    expect(accountRepository.listBalanceAdjustments).toHaveBeenCalledWith(
      'acc-1',
      'ws-1',
      20,
    );
  });

  it.each([
    ['unknown account', null, AccountNotFoundError],
    ['account of another workspace', makeChecking('ws-2'), UnauthorizedError],
  ])('rejects an %s', async (_label, account, ErrorClass) => {
    accountRepository.findById.mockResolvedValue(account);

    const result = await service.execute({
      accountId: 'acc-1',
      workspaceId: 'ws-1',
    });

    expect(result.isLeft() && result.value).toBeInstanceOf(ErrorClass);
    expect(accountRepository.listBalanceAdjustments).not.toHaveBeenCalled();
  });
});
