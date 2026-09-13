import { AccountType } from '@constants/enums';
import { CheckingAccount } from '@modules/account/entities/CheckingAccount';
import { ConflictAccountError } from '@modules/account/errors';
import { AccountRepository } from '@modules/account/repositories/contracts/AccountRepository';
import { RedisService } from '@infra/cache/redis/RedisService';
import { User } from '@modules/user/entities/User';
import { UserNotFoundError } from '@modules/user/errors';
import { UserRepository } from '@modules/user/repositories/contracts/user.repository';
import { CreateAccountService } from './create-account.service';

type ServiceRequest = Parameters<
  typeof CreateAccountService.prototype.execute
>[0];

function makeRequest(
  overrides: Partial<Record<string, unknown>> = {},
): ServiceRequest {
  return {
    sub: 'user-1',
    workspaceId: 'ws-1',
    name: 'My Account',
    timezone: 'America/Sao_Paulo',
    type: AccountType.CHECKING,
    balance: 0,
    ...overrides,
  } as ServiceRequest;
}

function makeUser(): User {
  const result = User.create(
    { name: 'John Doe', email: 'j@j.com', passwordHash: 'hash' },
    'user-1',
  );
  if (result.isLeft()) throw result.value;
  return result.value;
}

function makeAccount() {
  const result = CheckingAccount.create({
    workspaceId: 'ws-1',
    name: 'My Account',
    type: AccountType.CHECKING,
    timezone: 'America/Sao_Paulo',
  });
  if (result.isLeft()) throw result.value;
  return result.value;
}

describe('CreateAccountService', () => {
  let service: CreateAccountService;
  let accountRepository: jest.Mocked<AccountRepository>;
  let userRepository: jest.Mocked<UserRepository>;
  let redisService: jest.Mocked<RedisService>;

  beforeEach(() => {
    accountRepository = {
      findByNameAndWorkspaceId: jest.fn(),
      create: jest.fn(),
      findById: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      findManyByWorkspaceId: jest.fn(),
      findAllByWorkspaceId: jest.fn(),
      countByWorkspaceId: jest.fn(),
    } as jest.Mocked<AccountRepository>;

    userRepository = {
      findUniqueById: jest.fn(),
      findUniqueByEmail: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    } as jest.Mocked<UserRepository>;

    redisService = {
      delByPattern: jest.fn(),
      get: jest.fn(),
      set: jest.fn(),
      del: jest.fn(),
    } as unknown as jest.Mocked<RedisService>;

    service = new CreateAccountService(accountRepository, userRepository, redisService);
  });

  afterEach(() => jest.clearAllMocks());

  function arrangeSuccessMocks() {
    userRepository.findUniqueById.mockResolvedValue(makeUser());
    accountRepository.findByNameAndWorkspaceId.mockResolvedValue(null);
    accountRepository.create.mockImplementation(async (a) => a);
  }

  it('should return left when user is not found', async () => {
    userRepository.findUniqueById.mockResolvedValue(null);

    const result = await service.execute(makeRequest());
    expect(result.isLeft()).toBe(true);
    expect(result.value).toBeInstanceOf(UserNotFoundError);
  });

  it('should return left when account name already exists', async () => {
    userRepository.findUniqueById.mockResolvedValue(makeUser());
    accountRepository.findByNameAndWorkspaceId.mockResolvedValue(makeAccount());

    const result = await service.execute(makeRequest());
    expect(result.isLeft()).toBe(true);
    expect(result.value).toBeInstanceOf(ConflictAccountError);
  });

  it('should create a CHECKING account successfully', async () => {
    arrangeSuccessMocks();

    const result = await service.execute(
      makeRequest({ type: AccountType.CHECKING }),
    );
    expect(result.isRight()).toBe(true);
    expect(accountRepository.create).toHaveBeenCalledTimes(1);
  });

  it('should create a CASH account successfully', async () => {
    arrangeSuccessMocks();

    const result = await service.execute(
      makeRequest({ type: AccountType.CASH }),
    );
    expect(result.isRight()).toBe(true);
    expect(accountRepository.create).toHaveBeenCalledTimes(1);
  });

  it('should create a CREDIT_CARD account successfully', async () => {
    arrangeSuccessMocks();

    const result = await service.execute(
      makeRequest({
        type: AccountType.CREDIT_CARD,
        creditLimit: 5000,
        closingDaysBeforeDue: 10,
        dueDay: 20,
      }),
    );
    expect(result.isRight()).toBe(true);
    expect(accountRepository.create).toHaveBeenCalledTimes(1);
  });

  it('should create a CREDIT_CARD without creditLimit (unlimited)', async () => {
    arrangeSuccessMocks();

    const result = await service.execute(
      makeRequest({
        type: AccountType.CREDIT_CARD,
        creditLimit: undefined,
        closingDaysBeforeDue: 10,
        dueDay: 20,
      }),
    );
    expect(result.isRight()).toBe(true);
    expect(accountRepository.create).toHaveBeenCalledTimes(1);
  });

  // Depois do pivô, `closingDaysBeforeDue` deixou de ser opcional: sem ele o
  // ciclo de fatura não tem como ser calculado (viraria NaN em
  // calculateInvoiceCycle). O service precisa recusar, não persistir.
  it('should NOT create a CREDIT_CARD without closingDaysBeforeDue', async () => {
    arrangeSuccessMocks();

    const result = await service.execute(
      makeRequest({
        type: AccountType.CREDIT_CARD,
        creditLimit: 5000,
        closingDaysBeforeDue: undefined,
        dueDay: 20,
      }),
    );
    expect(result.isLeft()).toBe(true);
    expect(accountRepository.create).not.toHaveBeenCalled();
  });
});
