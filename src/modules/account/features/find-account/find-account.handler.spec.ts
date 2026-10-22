import { AccountType } from '@constants/enums';
import { CheckingAccount } from '@modules/account/entities/CheckingAccount';
import { AccountRepository } from '@modules/account/repositories/contracts/AccountRepository';
import { UnauthorizedError } from '@shared/errors/UnauthorizedError';
import { FindAccountByIdService } from './find-account.handler';

function makeRequest(overrides = {}) {
  return { accountId: 'acc-1', workspaceId: 'ws-1', ...overrides };
}

function makeAccount(workspaceId = 'ws-1') {
  const result = CheckingAccount.create(
    {
      workspaceId,
      name: 'Conta Test',
      type: AccountType.CHECKING,
      timezone: 'America/Sao_Paulo',
    },
    'acc-1',
  );
  if (result.isLeft()) throw result.value;
  return result.value;
}

describe('FindAccountByIdService', () => {
  let service: FindAccountByIdService;
  let accountRepository: jest.Mocked<AccountRepository>;

  beforeEach(() => {
    accountRepository = {
      findById: jest.fn(),
      create: jest.fn(),
      createWithOpeningMovement: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      findByNameAndWorkspaceId: jest.fn(),
      findManyByWorkspaceId: jest.fn(),
      findAllByWorkspaceId: jest.fn(),
      countByWorkspaceId: jest.fn(),
    } as jest.Mocked<AccountRepository>;

    service = new FindAccountByIdService(accountRepository);
  });

  afterEach(() => jest.clearAllMocks());

  it('should return left(UnauthorizedError) when account is not found', async () => {
    accountRepository.findById.mockResolvedValue(null);

    const result = await service.execute(makeRequest());
    expect(result.isLeft()).toBe(true);
    expect(result.value).toBeInstanceOf(UnauthorizedError);
  });

  it('should return left(UnauthorizedError) when account belongs to another workspace', async () => {
    accountRepository.findById.mockResolvedValue(makeAccount('other-ws'));

    const result = await service.execute(makeRequest());
    expect(result.isLeft()).toBe(true);
    expect(result.value).toBeInstanceOf(UnauthorizedError);
  });

  it('should return right with the account when found and authorized', async () => {
    const account = makeAccount('ws-1');
    accountRepository.findById.mockResolvedValue(account);

    const result = await service.execute(makeRequest());
    expect(result.isRight()).toBe(true);
    if (result.isRight()) expect(result.value).toBe(account);
  });
});
