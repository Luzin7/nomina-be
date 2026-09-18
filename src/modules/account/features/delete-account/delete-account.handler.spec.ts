import { AccountType } from '@constants/enums';
import { CacheProvider } from '@infra/cache/contracts/CacheProvider';
import { CheckingAccount } from '@modules/account/entities/CheckingAccount';
import { AccountRepository } from '@modules/account/repositories/contracts/AccountRepository';
import { UnauthorizedError } from '@shared/errors/UnauthorizedError';
import { DeleteAccountService } from './delete-account.handler';

function makeRequest(overrides = {}) {
  return { accountId: 'acc-1', workspaceId: 'ws-1', ...overrides };
}

function makeAccount(workspaceId = 'ws-1') {
  const result = CheckingAccount.create(
    {
      workspaceId,
      name: 'Test Account',
      type: AccountType.CHECKING,
      timezone: 'America/Sao_Paulo',
    },
    'acc-1',
  );
  if (result.isLeft()) throw result.value;
  return result.value;
}

describe('DeleteAccountService', () => {
  let service: DeleteAccountService;
  let accountRepository: jest.Mocked<AccountRepository>;
  let redisService: jest.Mocked<Pick<CacheProvider, 'delByPattern'>>;

  beforeEach(() => {
    accountRepository = {
      findById: jest.fn(),
      delete: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      findByNameAndWorkspaceId: jest.fn(),
      findManyByWorkspaceId: jest.fn(),
      findAllByWorkspaceId: jest.fn(),
      countByWorkspaceId: jest.fn(),
    } as jest.Mocked<AccountRepository>;

    redisService = {
      delByPattern: jest.fn().mockResolvedValue(0),
    };

    service = new DeleteAccountService(
      accountRepository,
      redisService as unknown as CacheProvider,
    );
  });

  afterEach(() => jest.clearAllMocks());

  it('should return left(UnauthorizedError) when account belongs to a different workspace', async () => {
    accountRepository.findById.mockResolvedValue(makeAccount('other-ws'));

    const result = await service.execute(makeRequest());
    expect(result.isLeft()).toBe(true);
    expect(result.value).toBeInstanceOf(UnauthorizedError);
    expect(accountRepository.delete).not.toHaveBeenCalled();
    expect(redisService.delByPattern).not.toHaveBeenCalled();
  });

  it('should return left(UnauthorizedError) when account is not found', async () => {
    accountRepository.findById.mockResolvedValue(null);

    const result = await service.execute(makeRequest());
    expect(result.isLeft()).toBe(true);
    expect(result.value).toBeInstanceOf(UnauthorizedError);
    expect(redisService.delByPattern).not.toHaveBeenCalled();
  });

  it('should delete the account and return right when authorized', async () => {
    accountRepository.findById.mockResolvedValue(makeAccount('ws-1'));
    accountRepository.delete.mockResolvedValue();

    const result = await service.execute(makeRequest());
    expect(result.isRight()).toBe(true);
    expect(accountRepository.delete).toHaveBeenCalledWith('acc-1');
  });

  it('should invalidate the report cache for the workspace after deleting', async () => {
    accountRepository.findById.mockResolvedValue(makeAccount('ws-1'));
    accountRepository.delete.mockResolvedValue();

    await service.execute(makeRequest());

    expect(redisService.delByPattern).toHaveBeenCalledWith('report:*:ws-1:*');
  });
});
