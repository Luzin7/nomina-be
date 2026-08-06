import {
  AccountType,
  RecurrenceFrequency,
  TransactionType,
} from '@constants/enums';
import { CheckingAccount } from '@modules/account/entities/CheckingAccount';
import { AccountRepository } from '@modules/account/repositories/contracts/AccountRepository';
import { CategoryRepository } from '@modules/category/repositories/contracts/CategoryRepository';
import { Category } from '@modules/category/entities/Category';
import { RecurringTransactionRepository } from '@modules/transaction/repositories/contracts/RecurringTransactionRepository';
import { DateProvider } from '@providers/date/contracts/DateProvider';
import { UnauthorizedError } from '@shared/errors/UnauthorizedError';
import { CreateRecurringTransactionService } from './create-recurring-transaction.service';

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

function makeCategory(workspaceId: string | null = 'ws-1', id = 'cat-1') {
  const result = Category.create(
    {
      workspaceId,
      name: 'Moradia',
      type: TransactionType.EXPENSE,
      parentId: null,
      isSystemCategory: false,
    },
    id,
  );
  if (result.isLeft()) throw result.value;
  return result.value;
}

function makeRequest(overrides: Record<string, unknown> = {}) {
  return {
    sub: 'user-1',
    workspaceId: 'ws-1',
    accountId: 'acc-1',
    categoryId: 'cat-1',
    title: 'Aluguel',
    amount: 150000n,
    frequency: RecurrenceFrequency.MONTHLY,
    interval: 1,
    type: TransactionType.EXPENSE,
    startDate: '2099-02-01',
    ...overrides,
  };
}

describe('CreateRecurringTransactionService', () => {
  let service: CreateRecurringTransactionService;
  let recurringRepository: jest.Mocked<RecurringTransactionRepository>;
  let accountRepository: jest.Mocked<AccountRepository>;
  let categoryRepository: jest.Mocked<CategoryRepository>;
  let dateProvider: jest.Mocked<DateProvider>;

  beforeEach(() => {
    recurringRepository = {
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      findById: jest.fn(),
      findManyByWorkspaceId: jest.fn(),
      findNeedingGenerationByWorkspaceId: jest.fn(),
      listNeedingGeneration: jest.fn(),
      createGeneratedTransactions: jest.fn(),
    } as jest.Mocked<RecurringTransactionRepository>;

    accountRepository = {
      create: jest.fn(),
      findByNameAndWorkspaceId: jest.fn(),
      findById: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      findManyByWorkspaceId: jest.fn(),
      findAllByWorkspaceId: jest.fn(),
      countByWorkspaceId: jest.fn(),
    } as jest.Mocked<AccountRepository>;

    categoryRepository = {
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      findById: jest.fn(),
      countByWorkspaceId: jest.fn(),
      findUniqueByAttributes: jest.fn(),
      findManyByWorkspaceId: jest.fn(),
      countChildren: jest.fn(),
      countTransactions: jest.fn(),
      reassignChildren: jest.fn(),
      findManyByIds: jest.fn(),
      findSystemCategoryByName: jest.fn(),
    } as jest.Mocked<CategoryRepository>;

    dateProvider = {
      now: jest.fn().mockReturnValue(new Date('2024-01-01T00:00:00.000Z')),
      add: jest.fn((date: Date, amount: number, unit: string) => {
        const result = new Date(date);
        if (unit === 'day') result.setUTCDate(result.getUTCDate() + amount);
        if (unit === 'month') result.setUTCMonth(result.getUTCMonth() + amount);
        if (unit === 'year')
          result.setUTCFullYear(result.getUTCFullYear() + amount);
        return result;
      }),
      format: jest.fn(),
      toTimezone: jest.fn(),
      calculateInvoiceCycle: jest.fn(),
      addDaysInCurrentDate: jest.fn(),
      parse: jest.fn(),
      startOfDay: jest.fn((date) => new Date(date)),
      endOfDay: jest.fn(),
      startOfMonth: jest.fn(),
      endOfMonth: jest.fn(),
    } as unknown as jest.Mocked<DateProvider>;

    service = new CreateRecurringTransactionService(
      recurringRepository,
      accountRepository,
      categoryRepository,
      dateProvider,
    );
  });

  afterEach(() => jest.clearAllMocks());

  function arrangeSuccessMocks() {
    accountRepository.findById.mockResolvedValue(makeAccount());
    categoryRepository.findById.mockResolvedValue(makeCategory());
    recurringRepository.create.mockImplementation(async (r) => r);
  }

  it('should return left(UnauthorizedError) when account is not found', async () => {
    accountRepository.findById.mockResolvedValue(null);

    const result = await service.execute(makeRequest());

    expect(result.isLeft()).toBe(true);
    expect(result.value).toBeInstanceOf(UnauthorizedError);
  });

  it('should return left(UnauthorizedError) when account belongs to another workspace', async () => {
    accountRepository.findById.mockResolvedValue(makeAccount('ws-2'));

    const result = await service.execute(makeRequest());

    expect(result.isLeft()).toBe(true);
    expect(result.value).toBeInstanceOf(UnauthorizedError);
  });

  it('should return left(UnauthorizedError) when destination account belongs to another workspace', async () => {
    accountRepository.findById.mockImplementation(async (id) =>
      id === 'acc-1' ? makeAccount() : makeAccount('ws-2', 'acc-2'),
    );

    const result = await service.execute(
      makeRequest({
        type: TransactionType.TRANSFER,
        destinationAccountId: 'acc-2',
      }),
    );

    expect(result.isLeft()).toBe(true);
    expect(result.value).toBeInstanceOf(UnauthorizedError);
  });

  it('should return left(UnauthorizedError) when category belongs to another workspace', async () => {
    accountRepository.findById.mockResolvedValue(makeAccount());
    categoryRepository.findById.mockResolvedValue(makeCategory('ws-2'));

    const result = await service.execute(makeRequest({ categoryId: 'cat-1' }));

    expect(result.isLeft()).toBe(true);
    expect(result.value).toBeInstanceOf(UnauthorizedError);
  });

  it('should accept a global category (no workspaceId)', async () => {
    arrangeSuccessMocks();
    categoryRepository.findById.mockResolvedValue(makeCategory(null));

    const result = await service.execute(makeRequest({ categoryId: 'cat-1' }));

    expect(result.isRight()).toBe(true);
  });

  it('should return left when startDate is today or in the past', async () => {
    arrangeSuccessMocks();

    const result = await service.execute(
      makeRequest({ startDate: '2024-01-01' }),
    );

    expect(result.isLeft()).toBe(true);
  });

  it('should create the recurring transaction using the given amount', async () => {
    arrangeSuccessMocks();

    const result = await service.execute(makeRequest());

    expect(result.isRight()).toBe(true);
    expect(recurringRepository.create).toHaveBeenCalledTimes(1);
    if (result.isRight()) expect(result.value.amount).toBe(150000n);
  });

  it('should split totalAmount across installments and compute the endDate', async () => {
    arrangeSuccessMocks();

    const result = await service.execute(
      makeRequest({
        amount: undefined,
        totalAmount: 300000n,
        installments: 3,
        startDate: '2099-02-01',
      }),
    );

    expect(result.isRight()).toBe(true);
    if (result.isRight()) {
      expect(result.value.amount).toBe(100000n);
      expect(result.value.endDate).toEqual(new Date('2099-04-01'));
    }
  });

  it('should compute the endDate respecting a custom interval', async () => {
    arrangeSuccessMocks();

    const result = await service.execute(
      makeRequest({
        amount: undefined,
        totalAmount: 400000n,
        installments: 4,
        interval: 2,
        startDate: '2099-02-01',
      }),
    );

    expect(result.isRight()).toBe(true);
    if (result.isRight()) {
      expect(result.value.endDate).toEqual(new Date('2099-08-01'));
    }
  });
});
