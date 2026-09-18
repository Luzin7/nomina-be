import { AccountType } from '@constants/enums';
import { CacheProvider } from '@infra/cache/contracts/CacheProvider';
import { AccountRepository } from '@modules/account/repositories/contracts/AccountRepository';
import { TransactionRepository } from '@modules/transaction/repositories/contracts/TransactionRepository';
import { GetWorkspaceTimezoneService } from '@modules/workspace/services/get-workspace-timezone.service';
import { DateProvider } from '@providers/date/contracts/DateProvider';
import { FindMonthSummaryService } from './get-month-summary.service';

const NOW = new Date('2026-09-15T12:00:00.000Z');
const CURRENT_START = new Date('2026-09-01T03:00:00.000Z');
const CURRENT_END = new Date('2026-10-01T02:59:59.999Z');
const PREVIOUS_REFERENCE = new Date('2026-08-01T03:00:00.000Z');
const PREVIOUS_START = new Date('2026-08-01T03:00:00.000Z');
const PREVIOUS_END = new Date('2026-09-01T02:59:59.999Z');

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
  let dateProvider: jest.Mocked<DateProvider>;
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

    dateProvider = {
      now: jest.fn().mockReturnValue(NOW),
      startOfMonth: jest
        .fn()
        .mockReturnValueOnce(CURRENT_START)
        .mockReturnValueOnce(PREVIOUS_START),
      endOfMonth: jest
        .fn()
        .mockReturnValueOnce(CURRENT_END)
        .mockReturnValueOnce(PREVIOUS_END),
      add: jest.fn().mockReturnValue(PREVIOUS_REFERENCE),
      format: jest.fn().mockReturnValue('2026-09'),
    } as unknown as jest.Mocked<DateProvider>;

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
