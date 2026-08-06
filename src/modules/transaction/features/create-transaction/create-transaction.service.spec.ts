import { AccountType, TransactionType } from '@constants/enums';
import { RedisService } from '@infra/cache/redis/RedisService';
import { CheckingAccount } from '@modules/account/entities/CheckingAccount';
import { AccountRepository } from '@modules/account/repositories/contracts/AccountRepository';
import { Category } from '@modules/category/entities/Category';
import { CategoryRepository } from '@modules/category/repositories/contracts/CategoryRepository';
import { TransactionRepository } from '@modules/transaction/repositories/contracts/TransactionRepository';
import { DateProvider } from '@providers/date/contracts/DateProvider';
import { UnauthorizedError } from '@shared/errors/UnauthorizedError';
import { randomUUID } from 'crypto';
import { CreateTransactionService } from './create-transaction.service';

function makeRequest(
  overrides: Partial<
    Parameters<typeof CreateTransactionService.prototype.execute>[0]
  > = {},
) {
  return {
    sub: 'user-1',
    workspaceId: 'ws-1',
    accountId: 'acc-1',
    title: 'Grocery',
    amount: 5000n,
    date: '2024-01-15',
    type: TransactionType.EXPENSE,
    categoryId: randomUUID(),
    ...overrides,
  };
}

function makeAccount(workspaceId = 'ws-1', id = 'acc-1') {
  const result = CheckingAccount.create(
    {
      workspaceId,
      name: 'Account',
      type: AccountType.CHECKING,
      timezone: 'America/Sao_Paulo',
      balance: 10000n,
    },
    id,
  );
  if (result.isLeft()) throw result.value;
  return result.value;
}

describe('CreateTransactionService', () => {
  let service: CreateTransactionService;
  let accountRepository: jest.Mocked<AccountRepository>;
  let categoryRepository: jest.Mocked<CategoryRepository>;
  let transactionRepository: jest.Mocked<TransactionRepository>;
  let dateProvider: jest.Mocked<DateProvider>;

  beforeEach(() => {
    accountRepository = {
      findById: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      findByNameAndWorkspaceId: jest.fn(),
      findManyByWorkspaceId: jest.fn(),
      findAllByWorkspaceId: jest.fn(),
      countByWorkspaceId: jest.fn(),
    } as jest.Mocked<AccountRepository>;

    categoryRepository = {
      findById: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      countByWorkspaceId: jest.fn(),
      findUniqueByAttributes: jest.fn(),
      findManyByWorkspaceId: jest.fn(),
      countChildren: jest.fn(),
      countTransactions: jest.fn(),
      reassignChildren: jest.fn(),
      findManyByIds: jest.fn(),
    } as jest.Mocked<CategoryRepository>;

    transactionRepository = {
      createWithBalanceUpdate: jest.fn(),
      create: jest.fn(),
      findUniqueById: jest.fn(),
      listTransactionsByWorkspaceId: jest.fn(),
      getTopExpensesByCategory: jest.fn(),
      sumTransactionsByDateRange: jest.fn(),
      updateWithBalanceUpdate: jest.fn(),
      deleteWithBalanceReversion: jest.fn(),
      toggleStatusWithBalanceUpdate: jest.fn(),
      findByAccountAndDateRange: jest.fn(),
    } as jest.Mocked<TransactionRepository>;

    dateProvider = {
      startOfDay: jest.fn().mockImplementation((date) => new Date(date)),
      now: jest.fn().mockReturnValue(new Date('2024-01-01')),
      add: jest.fn(),
      format: jest.fn(),
      toTimezone: jest.fn(),
      calculateInvoiceCycle: jest.fn(),
      addDaysInCurrentDate: jest.fn(),
      parse: jest.fn(),
      endOfDay: jest.fn(),
      startOfMonth: jest.fn(),
      endOfMonth: jest.fn(),
    } as jest.Mocked<DateProvider>;

    service = new CreateTransactionService(
      accountRepository,
      categoryRepository,
      transactionRepository,
      dateProvider,
      {
        onModuleDestroy: jest.fn(),
        ping: jest.fn().mockResolvedValue(false),
        get: jest.fn().mockResolvedValue(null),
        set: jest.fn().mockResolvedValue(true),
        del: jest.fn().mockResolvedValue(true),
        exists: jest.fn().mockResolvedValue(false),
        acquireLock: jest.fn().mockResolvedValue(true),
        releaseLock: jest.fn().mockResolvedValue(true),
        delByPattern: jest.fn().mockResolvedValue(0),
        getClient: jest.fn().mockReturnValue(null),
        isAvailable: jest.fn().mockReturnValue(false),
      } as unknown as jest.Mocked<RedisService>,
    );
  });

  afterEach(() => jest.clearAllMocks());

  function arrangeSuccessMocks() {
    accountRepository.findById.mockResolvedValue(makeAccount());
    categoryRepository.findById.mockResolvedValue({
      id: randomUUID(),
      workspaceId: 'ws-1',
      name: 'Food',
      type: TransactionType.EXPENSE,
      parentId: null,
    } as jest.Mocked<Category>);
    transactionRepository.createWithBalanceUpdate.mockResolvedValue();
  }

  it('should return left(UnauthorizedError) when account is not found', async () => {
    accountRepository.findById.mockResolvedValue(null);

    const result = await service.execute(makeRequest());
    expect(result.isLeft()).toBe(true);
    expect(result.value).toBeInstanceOf(UnauthorizedError);
  });

  it('should return left(UnauthorizedError) when account belongs to different workspace', async () => {
    accountRepository.findById.mockResolvedValue(makeAccount('other-ws'));

    const result = await service.execute(makeRequest());
    expect(result.isLeft()).toBe(true);
    expect(result.value).toBeInstanceOf(UnauthorizedError);
  });

  it('should return left when TRANSFER has no destinationAccountId', async () => {
    accountRepository.findById.mockResolvedValue(makeAccount());

    const result = await service.execute(
      makeRequest({
        type: TransactionType.TRANSFER,
        destinationAccountId: null,
      }),
    );
    expect(result.isLeft()).toBe(true);
  });

  it('should create a transaction and return right on success', async () => {
    arrangeSuccessMocks();

    const result = await service.execute(makeRequest());
    expect(result.isRight()).toBe(true);
    expect(transactionRepository.createWithBalanceUpdate).toHaveBeenCalledTimes(
      1,
    );
  });

  it('should return left(AccountNotFoundError) when TRANSFER destination is not found', async () => {
    accountRepository.findById
      .mockResolvedValueOnce(makeAccount())
      .mockResolvedValueOnce(null);

    const result = await service.execute(
      makeRequest({
        type: TransactionType.TRANSFER,
        destinationAccountId: 'acc-nonexistent',
      }),
    );
    expect(result.isLeft()).toBe(true);
  });
});
