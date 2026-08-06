import { TransactionStatus, TransactionType } from '@constants/enums';
import { Transaction } from '@modules/transaction/entities/Transaction';
import { TransactionNotFoundError } from '@modules/transaction/errors';
import { TransactionRepository } from '@modules/transaction/repositories/contracts/TransactionRepository';
import { UnauthorizedError } from '@shared/errors/UnauthorizedError';
import { FindTransactionByIdService } from './find-transaction.handle';

function makeRequest(overrides = {}) {
  return { workspaceId: 'ws-1', transactionId: 'tx-1', ...overrides };
}

function makeTransaction(workspaceId = 'ws-1'): Transaction {
  const result = Transaction.create(
    {
      workspaceId,
      accountId: 'acc-1',
      categoryId: 'cat-1',
      title: 'Test',
      amount: 1000n,
      date: new Date('2024-01-01'),
      type: TransactionType.EXPENSE,
      status: TransactionStatus.COMPLETED,
    },
    'tx-1',
  );
  if (result.isLeft()) throw result.value;
  return result.value;
}

describe('FindTransactionByIdService', () => {
  let service: FindTransactionByIdService;
  let transactionRepository: jest.Mocked<TransactionRepository>;

  beforeEach(() => {
    transactionRepository = {
      findUniqueById: jest.fn(),
      create: jest.fn(),
      listTransactionsByWorkspaceId: jest.fn(),
      getTopExpensesByCategory: jest.fn(),
      sumTransactionsByDateRange: jest.fn(),
      createWithBalanceUpdate: jest.fn(),
      updateWithBalanceUpdate: jest.fn(),
      deleteWithBalanceReversion: jest.fn(),
      toggleStatusWithBalanceUpdate: jest.fn(),
      findByAccountAndDateRange: jest.fn(),
    } as jest.Mocked<TransactionRepository>;

    service = new FindTransactionByIdService(transactionRepository);
  });

  afterEach(() => jest.clearAllMocks());

  it('should return left(TransactionNotFoundError) when transaction does not exist', async () => {
    transactionRepository.findUniqueById.mockResolvedValue(null);

    const result = await service.execute(makeRequest());
    expect(result.isLeft()).toBe(true);
    expect(result.value).toBeInstanceOf(TransactionNotFoundError);
  });

  it('should return left(UnauthorizedError) when transaction belongs to a different workspace', async () => {
    transactionRepository.findUniqueById.mockResolvedValue(
      makeTransaction('ws-other'),
    );

    const result = await service.execute(makeRequest({ workspaceId: 'ws-1' }));
    expect(result.isLeft()).toBe(true);
    expect(result.value).toBeInstanceOf(UnauthorizedError);
  });

  it('should return right with transaction on success', async () => {
    const tx = makeTransaction('ws-1');
    transactionRepository.findUniqueById.mockResolvedValue(tx);

    const result = await service.execute(makeRequest());
    expect(result.isRight()).toBe(true);
    if (result.isRight()) expect(result.value).toBe(tx);
  });
});
