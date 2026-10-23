import { TransactionStatus } from '@constants/enums';
import { CacheProvider } from '@infra/cache/contracts/CacheProvider';
import { AccountNotFoundError } from '@modules/account/errors';
import {
  TransactionAlreadyCompletedError,
  TransactionNotFoundError,
} from '@modules/transaction/errors';
import { TransactionRepository } from '@modules/transaction/repositories/contracts/TransactionRepository';
import { makeTransactionWithStatus } from '@modules/transaction/test-helpers/mock-factories';
import { left, right } from '@shared/core/errors/Either';
import { SetTransactionStatusService } from './set-transaction-status.service';

type ServiceRequest = Parameters<
  typeof SetTransactionStatusService.prototype.execute
>[0];

function makeRequest(overrides: Partial<ServiceRequest> = {}): ServiceRequest {
  return {
    transactionId: 'tx-1',
    workspaceId: 'ws-1',
    sub: 'user-1',
    status: TransactionStatus.COMPLETED,
    ...overrides,
  };
}

describe('SetTransactionStatusService', () => {
  let service: SetTransactionStatusService;
  let transactionRepository: jest.Mocked<TransactionRepository>;
  let cacheProvider: jest.Mocked<CacheProvider>;

  beforeEach(() => {
    transactionRepository = {
      create: jest.fn(),
      findUniqueById: jest.fn(),
      listTransactionsByWorkspaceId: jest.fn(),
      getTopExpensesByCategory: jest.fn(),
      sumTransactionsByDateRange: jest.fn(),
      createWithBalanceUpdate: jest.fn(),
      updateWithBalanceEffect: jest.fn(),
      deleteWithBalanceEffect: jest.fn(),
      updateStatusWithBalanceEffect: jest.fn(),
      findCreditCardLedger: jest.fn(),
      findDueCardTransactions: jest.fn(),
    } as jest.Mocked<TransactionRepository>;

    cacheProvider = {
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
    } as unknown as jest.Mocked<CacheProvider>;

    service = new SetTransactionStatusService(
      transactionRepository,
      cacheProvider,
    );
  });

  afterEach(() => jest.clearAllMocks());

  it('should request the desired status scoped by workspace', async () => {
    transactionRepository.updateStatusWithBalanceEffect.mockResolvedValue(
      right(makeTransactionWithStatus(TransactionStatus.COMPLETED)),
    );

    await service.execute(
      makeRequest({ status: TransactionStatus.PENDING, workspaceId: 'ws-9' }),
    );

    expect(
      transactionRepository.updateStatusWithBalanceEffect,
    ).toHaveBeenCalledWith(
      {
        transactionId: 'tx-1',
        workspaceId: 'ws-9',
        status: TransactionStatus.PENDING,
      },
      { actorId: 'user-1' },
    );
  });

  it('should return left(TransactionNotFoundError) from the repository', async () => {
    const notFound = new TransactionNotFoundError();
    transactionRepository.updateStatusWithBalanceEffect.mockResolvedValue(
      left(notFound),
    );

    const result = await service.execute(makeRequest());

    expect(result.isLeft()).toBe(true);
    expect(result.value).toBe(notFound);
  });

  it('should return left(TransactionAlreadyCompletedError) from the repository', async () => {
    transactionRepository.updateStatusWithBalanceEffect.mockResolvedValue(
      left(new TransactionAlreadyCompletedError()),
    );

    const result = await service.execute(makeRequest());

    expect(result.isLeft()).toBe(true);
    expect(result.value).toBeInstanceOf(TransactionAlreadyCompletedError);
  });

  it('should propagate left(AccountNotFoundError) from the repository', async () => {
    const accountNotFound = new AccountNotFoundError('Conta não encontrada.');
    transactionRepository.updateStatusWithBalanceEffect.mockResolvedValue(
      left(accountNotFound),
    );

    const result = await service.execute(makeRequest());

    expect(result.isLeft()).toBe(true);
    expect(result.value).toBe(accountNotFound);
  });

  it('should return the transaction confirmed by the repository', async () => {
    const confirmed = makeTransactionWithStatus(TransactionStatus.PENDING);
    transactionRepository.updateStatusWithBalanceEffect.mockResolvedValue(
      right(confirmed),
    );

    const result = await service.execute(makeRequest());

    expect(result.isRight()).toBe(true);
    if (result.isRight()) {
      expect(result.value.status).toBe(TransactionStatus.PENDING);
    }
  });

  it('should invalidate workspace reports after a confirmed change', async () => {
    transactionRepository.updateStatusWithBalanceEffect.mockResolvedValue(
      right(makeTransactionWithStatus(TransactionStatus.COMPLETED)),
    );

    await service.execute(makeRequest());

    expect(cacheProvider.delByPattern).toHaveBeenCalledWith('report:*:ws-1:*');
  });

  it('should not touch the cache when the change is rejected', async () => {
    transactionRepository.updateStatusWithBalanceEffect.mockResolvedValue(
      left(new TransactionNotFoundError()),
    );

    await service.execute(makeRequest());

    expect(cacheProvider.delByPattern).not.toHaveBeenCalled();
  });
});
