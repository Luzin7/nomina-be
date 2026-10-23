import {
  AccountType,
  TransactionStatus,
  TransactionType,
} from '@constants/enums';
import { CacheProvider } from '@infra/cache/contracts/CacheProvider';
import { CheckingAccount } from '@modules/account/entities/CheckingAccount';
import { InvestmentAccount } from '@modules/account/entities/InvestmentAccount';
import { AccountRepository } from '@modules/account/repositories/contracts/AccountRepository';
import { Category } from '@modules/category/entities/Category';
import { CategoryRepository } from '@modules/category/repositories/contracts/CategoryRepository';
import {
  InstallmentCountOutOfRangeError,
  InvestmentAccountNotAllowedError,
} from '@modules/transaction/errors';
import { TransactionRepository } from '@modules/transaction/repositories/contracts/TransactionRepository';
import { DateProvider } from '@providers/date/contracts/DateProvider';
import { right } from '@shared/core/errors/Either';
import { CreateInstallmentPurchaseService } from './create-installment-purchase.service';

const TODAY = '2024-03-10';

function makeChecking() {
  const result = CheckingAccount.create(
    {
      workspaceId: 'ws-1',
      name: 'Conta',
      type: AccountType.CHECKING,
      timezone: 'UTC',
      balance: 100000n,
    },
    'acc-1',
  );
  if (result.isLeft()) throw result.value;
  return result.value;
}

function makeInvestment() {
  const result = InvestmentAccount.create(
    {
      workspaceId: 'ws-1',
      name: 'Investimento',
      timezone: 'UTC',
    },
    'acc-1',
  );
  if (result.isLeft()) throw result.value;
  return result.value;
}

function makeCategory() {
  const result = Category.create(
    {
      workspaceId: 'ws-1',
      name: 'Compras',
      type: TransactionType.EXPENSE,
      parentId: null,
      isSystemCategory: false,
    },
    'cat-1',
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
    title: 'Notebook',
    totalAmount: 10000n,
    installments: 3,
    purchaseDate: TODAY,
    type: TransactionType.EXPENSE as const,
    ...overrides,
  };
}

describe('CreateInstallmentPurchaseService', () => {
  let service: CreateInstallmentPurchaseService;
  let accountRepository: jest.Mocked<AccountRepository>;
  let categoryRepository: jest.Mocked<CategoryRepository>;
  let transactionRepository: jest.Mocked<TransactionRepository>;
  let cache: jest.Mocked<CacheProvider>;
  let dateProvider: jest.Mocked<DateProvider>;

  beforeEach(() => {
    accountRepository = {
      findById: jest.fn().mockResolvedValue(makeChecking()),
    } as unknown as jest.Mocked<AccountRepository>;
    categoryRepository = {
      findById: jest.fn().mockResolvedValue(makeCategory()),
    } as unknown as jest.Mocked<CategoryRepository>;
    transactionRepository = {
      createInstallmentPlan: jest.fn().mockResolvedValue(right(undefined)),
    } as unknown as jest.Mocked<TransactionRepository>;
    cache = {
      delByPattern: jest.fn().mockResolvedValue(0),
    } as unknown as jest.Mocked<CacheProvider>;
    dateProvider = {
      now: jest.fn().mockReturnValue(new Date(`${TODAY}T15:00:00.000Z`)),
      startOfDay: jest.fn((date: string | Date) => {
        const iso = new Date(date).toISOString().slice(0, 10);
        return new Date(`${iso}T00:00:00.000Z`);
      }),
      add: jest.fn((date: Date, amount: number, unit: string) => {
        const result = new Date(date);
        if (unit === 'month') result.setUTCMonth(result.getUTCMonth() + amount);
        return result;
      }),
    } as unknown as jest.Mocked<DateProvider>;

    service = new CreateInstallmentPurchaseService(
      accountRepository,
      categoryRepository,
      transactionRepository,
      dateProvider,
      cache,
    );
  });

  it('should create the plan and the first installment for a purchase today', async () => {
    const result = await service.execute(makeRequest());

    if (result.isLeft()) throw result.value;
    const { recurring, firstInstallment } = result.value;
    expect(recurring.installmentCount).toBe(3);
    expect(recurring.lastGenerated).toEqual(recurring.startDate);
    expect(recurring.endDate).toEqual(new Date('2024-05-10T00:00:00.000Z'));
    expect(firstInstallment.recurringId).toBe(recurring.id);
    expect(firstInstallment.status).toBe(TransactionStatus.COMPLETED);
    expect(transactionRepository.createInstallmentPlan).toHaveBeenCalledTimes(
      1,
    );
    expect(cache.delByPattern).toHaveBeenCalledWith('report:*:ws-1:*');
  });

  it('should put the remainder on the first installment', async () => {
    const result = await service.execute(makeRequest());

    if (result.isLeft()) throw result.value;
    const { recurring, firstInstallment } = result.value;
    expect(recurring.amount).toBe(3333n);
    expect(firstInstallment.amount).toBe(3334n);
  });

  it('should reject an investment account', async () => {
    accountRepository.findById.mockResolvedValue(makeInvestment());

    const result = await service.execute(makeRequest());

    expect(result.value).toBeInstanceOf(InvestmentAccountNotAllowedError);
    expect(transactionRepository.createInstallmentPlan).not.toHaveBeenCalled();
  });

  it.each([1, 366])(
    'should reject installments outside 2 to 365 (%i)',
    async (installments) => {
      const result = await service.execute(makeRequest({ installments }));

      expect(result.value).toBeInstanceOf(InstallmentCountOutOfRangeError);
      expect(
        transactionRepository.createInstallmentPlan,
      ).not.toHaveBeenCalled();
    },
  );
});
