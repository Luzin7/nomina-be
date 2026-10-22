import { AccountType, TransactionType } from '@constants/enums';
import { CacheProvider } from '@infra/cache/contracts/CacheProvider';
import { CheckingAccount } from '@modules/account/entities/CheckingAccount';
import { AccountRepository } from '@modules/account/repositories/contracts/AccountRepository';
import { makeCreditCard } from '@modules/account/test-helpers/mock-factories';
import { SYSTEM_CATEGORY } from '@modules/category/constants/system-categories';
import { Category } from '@modules/category/entities/Category';
import { CategoryRepository } from '@modules/category/repositories/contracts/CategoryRepository';
import { Transaction } from '@modules/transaction/entities/Transaction';
import { CreditCardTransferNotAllowedError } from '@modules/transaction/errors';
import { TransactionRepository } from '@modules/transaction/repositories/contracts/TransactionRepository';
import { DateProvider } from '@providers/date/contracts/DateProvider';
import { right } from '@shared/core/errors/Either';
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
      createWithOpeningMovement: jest.fn(),
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
      updateWithBalanceEffect: jest.fn(),
      deleteWithBalanceEffect: jest.fn(),
      updateStatusWithBalanceEffect: jest.fn(),
      findCreditCardLedger: jest.fn(),
    } as jest.Mocked<TransactionRepository>;

    dateProvider = {
      startOfDay: jest.fn().mockImplementation((date) => new Date(date)),
      now: jest.fn().mockReturnValue(new Date('2024-01-01')),
      add: jest.fn(),
      format: jest.fn(),
      toTimezone: jest.fn(),
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
      } as unknown as jest.Mocked<CacheProvider>,
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
    transactionRepository.createWithBalanceUpdate.mockResolvedValue(
      right(undefined),
    );
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
    const lockedAccount = makeAccount();
    let deltas: Map<string, bigint> | undefined;
    transactionRepository.createWithBalanceUpdate.mockImplementation(
      (_transaction, applyEffects) => {
        const applied = applyEffects(
          new Map([[lockedAccount.id, lockedAccount]]),
        );
        if (applied.isLeft()) throw applied.value;
        deltas = applied.value;
        return Promise.resolve(right(undefined));
      },
    );

    const result = await service.execute(makeRequest({ date: '2023-12-15' }));
    expect(result.isRight()).toBe(true);
    expect(deltas?.get(lockedAccount.id)).toBe(-5000n);
    expect(transactionRepository.createWithBalanceUpdate).toHaveBeenCalledWith(
      expect.any(Transaction),
      expect.any(Function),
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

  describe('TRANSFER', () => {
    function arrangeTransferMocks() {
      accountRepository.findById
        .mockResolvedValueOnce(makeAccount())
        .mockResolvedValueOnce(makeAccount('ws-1', 'acc-2'));
      transactionRepository.createWithBalanceUpdate.mockResolvedValue(
        right(undefined),
      );
    }

    function makeTransferRequest(overrides: { date?: string } = {}) {
      return makeRequest({
        type: TransactionType.TRANSFER,
        destinationAccountId: 'acc-2',
        categoryId: undefined,
        ...overrides,
      });
    }

    it('should create a TRANSFER when the destination account is valid', async () => {
      arrangeTransferMocks();
      const source = makeAccount();
      const destination = makeAccount('ws-1', 'acc-2');
      let deltas: Map<string, bigint> | undefined;
      transactionRepository.createWithBalanceUpdate.mockImplementation(
        (_transaction, applyEffects) => {
          const applied = applyEffects(
            new Map([
              [source.id, source],
              [destination.id, destination],
            ]),
          );
          if (applied.isLeft()) throw applied.value;
          deltas = applied.value;
          return Promise.resolve(right(undefined));
        },
      );

      const result = await service.execute(
        makeTransferRequest({ date: '2023-12-15' }),
      );

      expect(result.isRight()).toBe(true);
      expect(deltas?.get('acc-1')).toBe(-5000n);
      expect(deltas?.get('acc-2')).toBe(5000n);
      expect(
        transactionRepository.createWithBalanceUpdate,
      ).toHaveBeenCalledTimes(1);
    });

    // Transferência não é gasto nem receita: o usuário não escolhe categoria e
    // o backend usa a de sistema, cujo ID é fixo. Sem isso, toda transferência
    // batia na regra de categoria obrigatória e falhava.
    it('should use the system transfer category when none is provided', async () => {
      arrangeTransferMocks();

      const result = await service.execute(makeTransferRequest());

      expect(result.isRight()).toBe(true);
      if (result.isRight()) {
        expect(result.value.categoryId).toBe(SYSTEM_CATEGORY.TRANSFER.id);
      }
      // O ID é constante, então nem chega a consultar o repositório.
      expect(categoryRepository.findById).not.toHaveBeenCalled();
    });

    it('should reject a TRANSFER whose destination is a credit card', async () => {
      accountRepository.findById
        .mockResolvedValueOnce(makeAccount())
        .mockResolvedValueOnce(makeCreditCard({ id: 'acc-cc' }));

      const result = await service.execute(
        makeRequest({
          type: TransactionType.TRANSFER,
          destinationAccountId: 'acc-cc',
          categoryId: undefined,
        }),
      );

      expect(result.isLeft()).toBe(true);
      expect(result.value).toBeInstanceOf(CreditCardTransferNotAllowedError);
    });
  });
});
