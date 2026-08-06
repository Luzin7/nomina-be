import { AccountType, TransactionStatus } from '@constants/enums';
import { CheckingAccount } from '@modules/account/entities/CheckingAccount';
import { AccountNotFoundError } from '@modules/account/errors';
import { AccountRepository } from '@modules/account/repositories/contracts/AccountRepository';
import { Transaction } from '@modules/transaction/entities/Transaction';
import { TransactionNotFoundError } from '@modules/transaction/errors';
import { TransactionRepository } from '@modules/transaction/repositories/contracts/TransactionRepository';
import { RedisService } from '@infra/cache/redis/RedisService';
import { UnauthorizedError } from '@shared/errors/UnauthorizedError';
import { DeleteTransactionService } from './delete-transaction.service';

type ServiceRequest = Parameters<
  typeof DeleteTransactionService.prototype.execute
>[0];

function makeRequest(
  overrides: Partial<Record<string, unknown>> = {},
): ServiceRequest {
  return {
    transactionId: 'tx-1',
    sub: 'user-1',
    workspaceId: 'ws-1',
    name: 'User',
    role: 'USER',
    ...overrides,
  } as ServiceRequest;
}

function makeTransaction(status: TransactionStatus): Transaction {
  // Transaction.create overrides status based on date: future → PENDING, past → COMPLETED
  const date =
    status === TransactionStatus.PENDING
      ? new Date(Date.now() + 86400000)
      : new Date(Date.now() - 86400000);
  const r = Transaction.create(
    {
      workspaceId: 'ws-1',
      accountId: 'acc-1',
      categoryId: 'cat-1',
      title: 'Test Tx',
      amount: 100n,
      date,
      type: 'EXPENSE',
      status,
    },
    'tx-1',
  );
  if (r.isLeft()) throw r.value;
  return r.value;
}

function makeCheckingAccount(): CheckingAccount {
  const r = CheckingAccount.create(
    {
      workspaceId: 'ws-1',
      name: 'Checking',
      timezone: 'UTC',
      type: AccountType.CHECKING,
      balance: 100000n,
    },
    'acc-1',
  );
  if (r.isLeft()) throw r.value;
  return r.value;
}

describe('DeleteTransactionService', () => {
  let service: DeleteTransactionService;
  let transactionRepository: jest.Mocked<TransactionRepository>;
  let accountRepository: jest.Mocked<AccountRepository>;

  beforeEach(() => {
    transactionRepository = {
      create: jest.fn(),
      findUniqueById: jest.fn(),
      listTransactionsByWorkspaceId: jest.fn(),
      getTopExpensesByCategory: jest.fn(),
      sumTransactionsByDateRange: jest.fn(),
      createWithBalanceUpdate: jest.fn(),
      updateWithBalanceUpdate: jest.fn(),
      deleteWithBalanceReversion: jest.fn(),
      toggleStatusWithBalanceUpdate: jest.fn(),
      findByAccountAndDateRange: jest.fn(),
    } as jest.Mocked<TransactionRepository>;

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

    service = new DeleteTransactionService(
      transactionRepository,
      accountRepository,
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

  it('should return left(TransactionNotFoundError) when transaction not found', async () => {
    transactionRepository.findUniqueById.mockResolvedValue(null);

    const result = await service.execute(makeRequest());
    expect(result.isLeft()).toBe(true);
    expect(result.value).toBeInstanceOf(TransactionNotFoundError);
  });

  it('should return left(UnauthorizedError) when transaction belongs to different workspace', async () => {
    transactionRepository.findUniqueById.mockResolvedValue(
      makeTransaction(TransactionStatus.PENDING),
    );

    const result = await service.execute(
      makeRequest({ workspaceId: 'ws-other' }),
    );
    expect(result.isLeft()).toBe(true);
    expect(result.value).toBeInstanceOf(UnauthorizedError);
  });

  it('should return left(AccountNotFoundError) when account not found', async () => {
    transactionRepository.findUniqueById.mockResolvedValue(
      makeTransaction(TransactionStatus.PENDING),
    );
    accountRepository.findById.mockResolvedValue(null);

    const result = await service.execute(makeRequest());
    expect(result.isLeft()).toBe(true);
    expect(result.value).toBeInstanceOf(AccountNotFoundError);
  });

  it('should delete a PENDING transaction without balance reversion', async () => {
    transactionRepository.findUniqueById.mockResolvedValue(
      makeTransaction(TransactionStatus.PENDING),
    );
    accountRepository.findById.mockResolvedValue(makeCheckingAccount());
    transactionRepository.deleteWithBalanceReversion.mockResolvedValue();

    const result = await service.execute(makeRequest());
    expect(result.isRight()).toBe(true);
    expect(
      transactionRepository.deleteWithBalanceReversion,
    ).toHaveBeenCalledTimes(1);
  });

  it('should delete a COMPLETED transaction reverting account balance', async () => {
    transactionRepository.findUniqueById.mockResolvedValue(
      makeTransaction(TransactionStatus.COMPLETED),
    );
    accountRepository.findById.mockResolvedValue(makeCheckingAccount());
    transactionRepository.deleteWithBalanceReversion.mockResolvedValue();

    const result = await service.execute(makeRequest());
    expect(result.isRight()).toBe(true);
    expect(
      transactionRepository.deleteWithBalanceReversion,
    ).toHaveBeenCalledTimes(1);
  });
});
