import { TransactionStatus, TransactionType } from '@constants/enums';
import { CacheProvider } from '@infra/cache/contracts/CacheProvider';
import { CheckingAccount } from '@modules/account/entities/CheckingAccount';
import { AccountRepository } from '@modules/account/repositories/contracts/AccountRepository';
import { Category } from '@modules/category/entities/Category';
import { CategoryRepository } from '@modules/category/repositories/contracts/CategoryRepository';
import { TransactionNotFoundError } from '@modules/transaction/errors';
import { TransactionRepository } from '@modules/transaction/repositories/contracts/TransactionRepository';
import {
  makeTransaction,
  makeTransactionWithStatus,
} from '@modules/transaction/test-helpers/mock-factories';
import { DateProvider } from '@providers/date/contracts/DateProvider';
import { left, right } from '@shared/core/errors/Either';
import { RecurringSuggestionDetectionDispatcher } from '../recurring-suggestions/recurring-suggestion-detection.dispatcher';
import { UpdateTransactionService } from './update-transaction.service';

type ServiceRequest = Parameters<
  typeof UpdateTransactionService.prototype.execute
>[0];

const makeRequest = (overrides: Partial<ServiceRequest> = {}): ServiceRequest =>
  ({
    transactionId: 'tx-1',
    accountId: 'acc-1',
    categoryId: 'cat-1',
    title: 'Aluguel',
    amount: 100n,
    date: '2023-12-15',
    type: TransactionType.EXPENSE,
    status: TransactionStatus.COMPLETED,
    workspaceId: 'ws-1',
    sub: 'user-1',
    ...overrides,
  }) as ServiceRequest;

const makeAccount = (): CheckingAccount => {
  const result = CheckingAccount.create(
    {
      workspaceId: 'ws-1',
      name: 'Account',
      type: 'CHECKING' as never,
      timezone: 'America/Sao_Paulo',
      balance: 0n,
    },
    'acc-1',
  );
  if (result.isLeft()) throw result.value;
  return result.value;
};

const makeCategory = (): Category =>
  ({ id: 'cat-1', workspaceId: 'ws-1', name: 'Moradia' }) as Category;

const makeRepositories = () => ({
  accountRepository: {
    findById: jest.fn().mockResolvedValue(makeAccount()),
  } as unknown as jest.Mocked<AccountRepository>,
  categoryRepository: {
    findById: jest.fn().mockResolvedValue(makeCategory()),
  } as unknown as jest.Mocked<CategoryRepository>,
  transactionRepository: {
    findUniqueById: jest.fn().mockResolvedValue(makeTransaction()),
    updateWithBalanceEffect: jest.fn(),
  } as unknown as jest.Mocked<TransactionRepository>,
});

describe('UpdateTransactionService', () => {
  let service: UpdateTransactionService;
  let accountRepository: jest.Mocked<AccountRepository>;
  let categoryRepository: jest.Mocked<CategoryRepository>;
  let transactionRepository: jest.Mocked<TransactionRepository>;
  let cacheProvider: jest.Mocked<CacheProvider>;
  let detectionDispatcher: jest.Mocked<RecurringSuggestionDetectionDispatcher>;

  beforeEach(() => {
    ({ accountRepository, categoryRepository, transactionRepository } =
      makeRepositories());
    cacheProvider = {
      incrementCounter: jest.fn().mockResolvedValue(1),
    } as unknown as jest.Mocked<CacheProvider>;
    detectionDispatcher = {
      notify: jest.fn(),
    } as unknown as jest.Mocked<RecurringSuggestionDetectionDispatcher>;

    const startOfDay = (value: string | Date): Date =>
      value instanceof Date ? value : new Date(`${value}T00:00:00.000Z`);

    service = new UpdateTransactionService(
      accountRepository,
      categoryRepository,
      transactionRepository,
      {
        now: jest.fn(() => new Date('2024-01-01T00:00:00.000Z')),
        startOfDay: jest.fn(startOfDay),
      } as unknown as jest.Mocked<DateProvider>,
      cacheProvider,
      detectionDispatcher,
    );
  });

  afterEach(() => jest.clearAllMocks());

  it('notifies detection once after the ledger bump without awaiting it', async () => {
    transactionRepository.updateWithBalanceEffect.mockResolvedValue(
      right(makeTransactionWithStatus(TransactionStatus.COMPLETED)),
    );
    const pendingDetection = new Promise<void>(() => undefined);
    (detectionDispatcher.notify as jest.Mock).mockReturnValue(pendingDetection);

    const result = await service.execute(makeRequest());

    expect(result.isRight()).toBe(true);
    expect(detectionDispatcher.notify).toHaveBeenCalledTimes(1);
    expect(detectionDispatcher.notify).toHaveBeenCalledWith('ws-1');
    expect(
      cacheProvider.incrementCounter.mock.invocationCallOrder[0],
    ).toBeLessThan(detectionDispatcher.notify.mock.invocationCallOrder[0]);
  });

  it('does not notify detection when the update is rejected', async () => {
    transactionRepository.updateWithBalanceEffect.mockResolvedValue(
      left(new TransactionNotFoundError()),
    );

    const result = await service.execute(makeRequest());

    expect(result.isLeft()).toBe(true);
    expect(detectionDispatcher.notify).not.toHaveBeenCalled();
  });
});
