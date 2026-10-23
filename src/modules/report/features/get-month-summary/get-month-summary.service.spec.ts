import { AccountType } from '@constants/enums';
import { CacheProvider } from '@infra/cache/contracts/CacheProvider';
import { AccountRepository } from '@modules/account/repositories/contracts/AccountRepository';
import { TransactionRepository } from '@modules/transaction/repositories/contracts/TransactionRepository';
import { GetWorkspaceTimezoneService } from '@modules/workspace/services/get-workspace-timezone.service';
import { DayJsDateProvider } from '@providers/date/implementations/Dayjs';
import { FindMonthSummaryService } from './get-month-summary.service';

const NOW = new Date('2026-09-15T12:00:00.000Z');
const CURRENT_START = new Date('2026-09-01T03:00:00.000Z');

type FakeTransaction = {
  date: Date;
  type: 'INCOME' | 'EXPENSE';
  amount: number;
};

function sumByRange(transactions: FakeTransaction[]) {
  return async (_workspaceId: string, start: Date, end: Date) => {
    const inRange = transactions.filter(
      (t) => t.date >= start && t.date <= end,
    );
    const sum = (type: FakeTransaction['type']) =>
      inRange
        .filter((t) => t.type === type)
        .reduce((total, t) => total + t.amount, 0);

    return {
      totalIncome: sum('INCOME'),
      totalExpense: sum('EXPENSE'),
      balance: sum('INCOME') - sum('EXPENSE'),
    };
  };
}

function makeAccounts() {
  return [
    { type: AccountType.CHECKING, balance: 1000 },
    { type: AccountType.CASH, balance: 500 },
    { type: AccountType.INVESTMENT, balance: 2000 },
    { type: AccountType.CREDIT_CARD, balance: -300 },
  ];
}

describe('FindMonthSummaryService', () => {
  let service: FindMonthSummaryService;
  let transactionRepository: jest.Mocked<TransactionRepository>;
  let accountRepository: jest.Mocked<AccountRepository>;
  let workspaceTimezone: jest.Mocked<GetWorkspaceTimezoneService>;
  let dateProvider: DayJsDateProvider;
  let nowSpy: jest.SpyInstance<Date, []>;
  let cache: jest.Mocked<CacheProvider>;

  beforeEach(() => {
    transactionRepository = {
      sumTransactionsByDateRange: jest.fn(),
    } as unknown as jest.Mocked<TransactionRepository>;

    accountRepository = {
      findAllByWorkspaceId: jest.fn().mockResolvedValue(makeAccounts()),
    } as unknown as jest.Mocked<AccountRepository>;

    workspaceTimezone = {
      execute: jest.fn().mockResolvedValue('America/Sao_Paulo'),
    } as unknown as jest.Mocked<GetWorkspaceTimezoneService>;

    dateProvider = new DayJsDateProvider();
    nowSpy = jest.spyOn(dateProvider, 'now').mockReturnValue(NOW);

    cache = {
      get: jest.fn().mockResolvedValue(null),
      set: jest.fn().mockResolvedValue(true),
    } as unknown as jest.Mocked<CacheProvider>;

    service = new FindMonthSummaryService(
      transactionRepository,
      accountRepository,
      workspaceTimezone,
      dateProvider,
      cache,
    );
  });

  afterEach(() => jest.clearAllMocks());

  it('aggregates balances, saving rate and previous month comparison', async () => {
    transactionRepository.sumTransactionsByDateRange
      .mockResolvedValue({ totalIncome: 0, totalExpense: 0, balance: 0 })
      .mockResolvedValueOnce({
        totalIncome: 10000,
        totalExpense: 4000,
        balance: 6000,
      })
      .mockResolvedValueOnce({
        totalIncome: 8000,
        totalExpense: 5000,
        balance: 3000,
      });

    const result = await service.execute({
      sub: 'user-1',
      workspaceId: 'ws-1',
    });

    expect(result.isRight()).toBe(true);
    if (!result.isRight()) return;

    expect(result.value.totalIncome).toBe(10000);
    expect(result.value.totalExpense).toBe(4000);
    expect(result.value.totalCheckingBalance).toBe(1500);
    expect(result.value.totalInvestmentBalance).toBe(2000);
    expect(result.value.totalCreditCardBalance).toBe(-300);
    expect(result.value.rate.currentMonthSaving).toBe(60);
    expect(result.value.rate.previousMonthCompareSaving).toBe(100);
  });

  describe('previousMonthToDate', () => {
    async function executeAt(now: Date, transactions: FakeTransaction[]) {
      nowSpy.mockReturnValue(now);
      transactionRepository.sumTransactionsByDateRange.mockImplementation(
        sumByRange(transactions),
      );

      const result = await service.execute({
        sub: 'user-1',
        workspaceId: 'ws-1',
      });
      if (!result.isRight()) throw new Error('expected right');

      return result.value.previousMonthToDate;
    }

    it('should return the previous month totals up to the same day', async () => {
      const previousMonthToDate = await executeAt(NOW, [
        {
          date: new Date('2026-08-01T10:00:00.000Z'),
          type: 'INCOME',
          amount: 1000,
        },
        {
          date: new Date('2026-08-15T10:00:00.000Z'),
          type: 'EXPENSE',
          amount: 300,
        },
        {
          date: new Date('2026-08-15T20:00:00.000Z'),
          type: 'EXPENSE',
          amount: 200,
        },
      ]);

      expect(previousMonthToDate).toEqual({
        totalIncome: 1000,
        totalExpense: 500,
      });
    });

    it('should clamp the day to the end of a shorter previous month', async () => {
      const previousMonthToDate = await executeAt(
        new Date('2026-03-31T12:00:00.000Z'),
        [
          {
            date: new Date('2026-02-28T20:00:00.000Z'),
            type: 'EXPENSE',
            amount: 700,
          },
          {
            date: new Date('2026-03-01T10:00:00.000Z'),
            type: 'EXPENSE',
            amount: 900,
          },
        ],
      );

      expect(previousMonthToDate).toEqual({
        totalIncome: 0,
        totalExpense: 700,
      });
    });

    it('should not include previous month transactions after the same day', async () => {
      const previousMonthToDate = await executeAt(NOW, [
        {
          date: new Date('2026-08-10T10:00:00.000Z'),
          type: 'EXPENSE',
          amount: 400,
        },
        {
          date: new Date('2026-08-16T10:00:00.000Z'),
          type: 'EXPENSE',
          amount: 5000,
        },
        {
          date: new Date('2026-08-31T10:00:00.000Z'),
          type: 'INCOME',
          amount: 9000,
        },
      ]);

      expect(previousMonthToDate).toEqual({
        totalIncome: 0,
        totalExpense: 400,
      });
    });
  });

  it('returns cached summary without querying repositories', async () => {
    cache.get.mockResolvedValue(
      JSON.stringify({
        month: CURRENT_START,
        totalIncome: 1,
        totalExpense: 2,
        totalCheckingBalance: 3,
        totalInvestmentBalance: 4,
        totalCreditCardBalance: 5,
        rate: { currentMonthSaving: 6, previousMonthCompareSaving: 7 },
        previousMonthToDate: { totalIncome: 8, totalExpense: 9 },
      }),
    );

    const result = await service.execute({
      sub: 'user-1',
      workspaceId: 'ws-1',
    });

    expect(result.isRight()).toBe(true);
    expect(
      transactionRepository.sumTransactionsByDateRange,
    ).not.toHaveBeenCalled();
    expect(accountRepository.findAllByWorkspaceId).not.toHaveBeenCalled();
  });
});
