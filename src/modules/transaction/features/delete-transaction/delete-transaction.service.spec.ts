import { TransactionStatus } from '@constants/enums';
import { AccountNotFoundError } from '@modules/account/errors';
import { Transaction } from '@modules/transaction/entities/Transaction';
import { TransactionNotFoundError } from '@modules/transaction/errors';
import { TransactionRepository } from '@modules/transaction/repositories/contracts/TransactionRepository';
import { CacheProvider } from '@infra/cache/contracts/CacheProvider';
import { left, right } from '@shared/core/errors/Either';
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

describe('DeleteTransactionService', () => {
  let service: DeleteTransactionService;

  let transactionRepository: jest.Mocked<TransactionRepository>;

  beforeEach(() => {
    transactionRepository = {
      create: jest.fn(),
      findUniqueById: jest.fn(),
      listTransactionsByWorkspaceId: jest.fn(),
      getTopExpensesByCategory: jest.fn(),
      sumTransactionsByDateRange: jest.fn(),
      createWithBalanceUpdate: jest.fn(),
      createInstallmentPlan: jest.fn(),
      updateWithBalanceEffect: jest.fn(),
      deleteWithBalanceEffect: jest.fn(),
      updateStatusWithBalanceEffect: jest.fn(),
      findCreditCardLedger: jest.fn(),
    } as jest.Mocked<TransactionRepository>;

    service = new DeleteTransactionService(transactionRepository, {
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
    } as unknown as jest.Mocked<CacheProvider>);
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

  it('should propagate left(AccountNotFoundError) from the repository', async () => {
    const accountNotFound = new AccountNotFoundError('Conta não encontrada.');
    transactionRepository.findUniqueById.mockResolvedValue(
      makeTransaction(TransactionStatus.PENDING),
    );
    transactionRepository.deleteWithBalanceEffect.mockResolvedValue(
      left(accountNotFound),
    );

    const result = await service.execute(makeRequest());
    expect(result.isLeft()).toBe(true);
    expect(result.value).toBe(accountNotFound);
  });

  it('should return left(TransactionNotFoundError) when the row is gone before deletion', async () => {
    transactionRepository.findUniqueById.mockResolvedValue(
      makeTransaction(TransactionStatus.PENDING),
    );
    transactionRepository.deleteWithBalanceEffect.mockResolvedValue(
      right(false),
    );

    const result = await service.execute(makeRequest());
    expect(result.isLeft()).toBe(true);
    expect(result.value).toBeInstanceOf(TransactionNotFoundError);
  });

  it('should delete a PENDING transaction', async () => {
    transactionRepository.findUniqueById.mockResolvedValue(
      makeTransaction(TransactionStatus.PENDING),
    );
    transactionRepository.deleteWithBalanceEffect.mockResolvedValue(
      right(true),
    );

    const result = await service.execute(makeRequest());
    expect(result.isRight()).toBe(true);
    expect(transactionRepository.deleteWithBalanceEffect).toHaveBeenCalledWith(
      'tx-1',
      { actorId: 'user-1' },
    );
  });

  it('should delete a COMPLETED transaction', async () => {
    transactionRepository.findUniqueById.mockResolvedValue(
      makeTransaction(TransactionStatus.COMPLETED),
    );
    transactionRepository.deleteWithBalanceEffect.mockResolvedValue(
      right(true),
    );

    const result = await service.execute(makeRequest());
    expect(result.isRight()).toBe(true);
    expect(transactionRepository.deleteWithBalanceEffect).toHaveBeenCalledWith(
      'tx-1',
      { actorId: 'user-1' },
    );
  });
});
