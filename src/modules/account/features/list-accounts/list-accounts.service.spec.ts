import { AccountType } from '@constants/enums';
import { CheckingAccount } from '@modules/account/entities/CheckingAccount';
import { AccountRepository } from '@modules/account/repositories/contracts/AccountRepository';
import { ListAccountsService } from './list-accounts.service';

function makeRequest(overrides = {}) {
  return { workspaceId: 'ws-1', page: 1, pageSize: 10, ...overrides };
}

function makeAccount() {
  const result = CheckingAccount.create({
    workspaceId: 'ws-1',
    name: 'Account',
    type: AccountType.CHECKING,
    timezone: 'America/Sao_Paulo',
  });
  if (result.isLeft()) throw result.value;
  return result.value;
}

describe('ListAccountsService', () => {
  let service: ListAccountsService;
  let accountRepository: jest.Mocked<AccountRepository>;

  beforeEach(() => {
    accountRepository = {
      findManyByWorkspaceId: jest.fn(),
      findById: jest.fn(),
      create: jest.fn(),
      createWithOpeningMovement: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      findByNameAndWorkspaceId: jest.fn(),
      findAllByWorkspaceId: jest.fn(),
      countByWorkspaceId: jest.fn(),
    } as jest.Mocked<AccountRepository>;

    service = new ListAccountsService(accountRepository);
  });

  afterEach(() => jest.clearAllMocks());

  it('should return accounts and total', async () => {
    const accounts = [makeAccount(), makeAccount()];
    accountRepository.findManyByWorkspaceId.mockResolvedValue({
      accounts,
      total: 2,
    });

    const result = await service.execute(makeRequest());
    expect(result.isRight()).toBe(true);
    if (result.isRight()) {
      expect(result.value.accounts).toHaveLength(2);
      expect(result.value.total).toBe(2);
    }
    expect(accountRepository.findManyByWorkspaceId).toHaveBeenCalledWith(
      'ws-1',
      1,
      10,
    );
  });

  it('should return empty list when no accounts exist', async () => {
    accountRepository.findManyByWorkspaceId.mockResolvedValue({
      accounts: [],
      total: 0,
    });

    const result = await service.execute(makeRequest());
    expect(result.isRight()).toBe(true);
    if (result.isRight()) {
      expect(result.value.accounts).toHaveLength(0);
      expect(result.value.total).toBe(0);
    }
  });
});
