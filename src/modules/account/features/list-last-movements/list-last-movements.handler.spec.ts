import { TransactionType } from '@constants/enums';
import {
  AccountLastMovement,
  AccountRepository,
} from '@modules/account/repositories/contracts/AccountRepository';
import { InMemoryCacheProvider } from '@shared/cache/test-helpers/in-memory-cache';
import { ListLastMovementsService } from './list-last-movements.handler';

const makeMovement = (
  overrides: Partial<AccountLastMovement> = {},
): AccountLastMovement => ({
  accountId: 'acc-1',
  transactionId: 'tx-1',
  title: 'Mercado',
  date: new Date('2026-11-20T12:00:00.000Z'),
  amountCents: 4500,
  type: TransactionType.EXPENSE,
  ...overrides,
});

describe('ListLastMovementsService', () => {
  let service: ListLastMovementsService;
  let accountRepository: jest.Mocked<AccountRepository>;

  beforeEach(() => {
    accountRepository = {
      findLastMovementsByWorkspaceId: jest.fn(),
    } as unknown as jest.Mocked<AccountRepository>;
    service = new ListLastMovementsService(
      accountRepository,
      new InMemoryCacheProvider(),
    );
  });

  it('returns the last movement of every account in one repository call', async () => {
    const movements = [
      makeMovement(),
      makeMovement({
        accountId: 'acc-2',
        transactionId: 'tx-2',
        title: 'Salário',
        type: TransactionType.INCOME,
        amountCents: 900000,
      }),
    ];
    accountRepository.findLastMovementsByWorkspaceId.mockResolvedValue(
      movements,
    );

    const result = await service.execute({ workspaceId: 'ws-1' });

    expect(result.isRight()).toBe(true);
    expect(result.value).toEqual({ movements });
    expect(
      accountRepository.findLastMovementsByWorkspaceId,
    ).toHaveBeenCalledTimes(1);
    expect(
      accountRepository.findLastMovementsByWorkspaceId,
    ).toHaveBeenCalledWith('ws-1');
  });

  it('returns an empty list when no account has a completed movement', async () => {
    accountRepository.findLastMovementsByWorkspaceId.mockResolvedValue([]);

    const result = await service.execute({ workspaceId: 'ws-1' });

    expect(result.value).toEqual({ movements: [] });
  });

  it('serves a repeated read from the ledger cache', async () => {
    accountRepository.findLastMovementsByWorkspaceId.mockResolvedValue([
      makeMovement(),
    ]);

    await service.execute({ workspaceId: 'ws-1' });
    const second = await service.execute({ workspaceId: 'ws-1' });

    expect(second.value).toEqual({ movements: [makeMovement()] });
    expect(
      accountRepository.findLastMovementsByWorkspaceId,
    ).toHaveBeenCalledTimes(1);
  });
});
