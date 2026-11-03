import { AccountType } from '@constants/enums';
import { CacheProvider } from '@infra/cache/contracts/CacheProvider';
import { AccountRepository } from '@modules/account/repositories/contracts/AccountRepository';
import { ReportRepository } from '@modules/report/repositories/contracts/ReportRepository';
import { GetWorkspaceTimezoneService } from '@modules/workspace/services/get-workspace-timezone.service';
import { DayJsDateProvider } from '@providers/date/implementations/Dayjs';
import { MonthProjectionRepository } from '@modules/report/repositories/contracts/MonthProjectionRepository';
import { FindMonthSummaryService } from './get-month-summary.service';

const NOW = new Date('2026-09-15T12:00:00.000Z');
const NOVEMBER_START_ISO = '2026-11-01T03:00:00.000Z';
const CURRENT_START = new Date('2026-09-01T03:00:00.000Z');

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
  let reportRepository: jest.Mocked<ReportRepository>;
  let accountRepository: jest.Mocked<AccountRepository>;
  let projectionRepository: jest.Mocked<MonthProjectionRepository>;
  let workspaceTimezone: jest.Mocked<GetWorkspaceTimezoneService>;
  let dateProvider: DayJsDateProvider;
  let nowSpy: jest.SpyInstance<Date, []>;
  let cache: jest.Mocked<CacheProvider>;

  beforeEach(() => {
    reportRepository = {
      findMonthSummaryMetrics: jest.fn(),
    } as unknown as jest.Mocked<ReportRepository>;

    accountRepository = {
      findAllByWorkspaceId: jest.fn().mockResolvedValue(makeAccounts()),
    } as unknown as jest.Mocked<AccountRepository>;

    projectionRepository = {
      findMonthLedger: jest.fn().mockResolvedValue([]),
      findActiveRecurringRules: jest.fn().mockResolvedValue([]),
    } as unknown as jest.Mocked<MonthProjectionRepository>;

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
      reportRepository,
      accountRepository,
      projectionRepository,
      workspaceTimezone,
      dateProvider,
      cache,
    );
  });

  afterEach(() => jest.clearAllMocks());

  it('aggregates balances, saving rate and previous month comparison', async () => {
    reportRepository.findMonthSummaryMetrics.mockResolvedValue({
      currentMonthData: { totalIncome: 10000, totalExpense: 4000 },
      previousMonthData: { totalIncome: 8000, totalExpense: 5000 },
      previousMonthToDateData: { totalIncome: 0, totalExpense: 0 },
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
    async function executeAt(
      now: Date,
      previousMonthToDateData = { totalIncome: 0, totalExpense: 0 },
    ) {
      nowSpy.mockReturnValue(now);
      reportRepository.findMonthSummaryMetrics.mockResolvedValue({
        currentMonthData: { totalIncome: 0, totalExpense: 0 },
        previousMonthData: { totalIncome: 0, totalExpense: 0 },
        previousMonthToDateData,
      });

      const result = await service.execute({
        sub: 'user-1',
        workspaceId: 'ws-1',
      });
      if (!result.isRight()) throw new Error('expected right');

      return result.value;
    }

    it('should return the previous month totals up to the same day', async () => {
      const summary = await executeAt(NOW, {
        totalIncome: 1000,
        totalExpense: 500,
      });

      expect(reportRepository.findMonthSummaryMetrics).toHaveBeenCalledWith(
        'ws-1',
        {
          currentStart: new Date('2026-09-01T03:00:00.000Z'),
          currentEnd: new Date('2026-10-01T02:59:59.999Z'),
          prevStart: new Date('2026-08-01T03:00:00.000Z'),
          prevEnd: new Date('2026-09-01T02:59:59.999Z'),
          prevMtdEnd: new Date('2026-08-16T02:59:59.999Z'),
        },
      );
      expect(summary.previousMonthToDate).toEqual({
        totalIncome: 1000,
        totalExpense: 500,
      });
    });

    it('should clamp the day to the end of a shorter previous month', async () => {
      await executeAt(new Date('2026-03-31T12:00:00.000Z'));

      expect(reportRepository.findMonthSummaryMetrics).toHaveBeenCalledWith(
        'ws-1',
        {
          currentStart: new Date('2026-03-01T03:00:00.000Z'),
          currentEnd: new Date('2026-04-01T02:59:59.999Z'),
          prevStart: new Date('2026-02-01T03:00:00.000Z'),
          prevEnd: new Date('2026-03-01T02:59:59.999Z'),
          prevMtdEnd: new Date('2026-03-01T02:59:59.999Z'),
        },
      );
    });

    it('should not include previous month transactions after the same day', async () => {
      await executeAt(NOW);

      expect(reportRepository.findMonthSummaryMetrics).toHaveBeenCalledWith(
        'ws-1',
        {
          currentStart: new Date('2026-09-01T03:00:00.000Z'),
          currentEnd: new Date('2026-10-01T02:59:59.999Z'),
          prevStart: new Date('2026-08-01T03:00:00.000Z'),
          prevEnd: new Date('2026-09-01T02:59:59.999Z'),
          prevMtdEnd: new Date('2026-08-16T02:59:59.999Z'),
        },
      );
    });
  });

  describe('projection', () => {
    const iso = (date: Date) => date.toISOString();

    async function executeAt(
      now: Date,
      totals = { totalIncome: 0, totalExpense: 0 },
    ) {
      nowSpy.mockReturnValue(now);
      reportRepository.findMonthSummaryMetrics.mockResolvedValue({
        currentMonthData: {
          totalIncome: totals.totalIncome,
          totalExpense: totals.totalExpense,
        },
        previousMonthData: { totalIncome: 0, totalExpense: 0 },
        previousMonthToDateData: { totalIncome: 0, totalExpense: 0 },
      });
      const result = await service.execute({
        sub: 'user-1',
        workspaceId: 'ws-1',
      });
      if (!result.isRight()) throw new Error('expected right');

      return result.value;
    }

    function lastQuery() {
      return projectionRepository.findMonthLedger.mock.calls[0][0];
    }

    it('should expose the current month totals as realized', async () => {
      const summary = await executeAt(NOW, {
        totalIncome: 10000,
        totalExpense: 4000,
      });

      expect(summary.projection.realized).toEqual({
        totalIncome: 10000,
        totalExpense: 4000,
      });
    });

    it('should keep October and key the cache by local day after UTC midnight', async () => {
      await executeAt(new Date('2026-11-01T02:30:00.000Z'));

      expect(iso(lastQuery().currentMonthStart)).toBe(
        '2026-10-01T03:00:00.000Z',
      );
      expect(cache.get).toHaveBeenCalledWith(
        'report:month-summary:v4:ws-1:2026-10-31',
      );
    });

    it('should query the ledger once from twelve months back to the end of the current month', async () => {
      await executeAt(new Date(NOVEMBER_START_ISO));

      expect(projectionRepository.findMonthLedger).toHaveBeenCalledTimes(1);
      expect(lastQuery()).toEqual({
        workspaceId: 'ws-1',
        timezone: 'America/Sao_Paulo',
        currentMonthStart: new Date(NOVEMBER_START_ISO),
        range: {
          start: new Date('2025-11-01T03:00:00.000Z'),
          end: new Date('2026-12-01T02:59:59.999Z'),
        },
      });
    });

    it('should use 28 days in February', async () => {
      const activeMonth = (key: string) => ({
        key,
        totalExpense: 0,
        pending: { totalIncome: 0, totalExpense: 0 },
        plainExpenses: [10, 11, 12, 13, 14, 28].map((day) => ({
          day,
          categoryId: 'cat-daily',
          amount: day === 28 ? 100 : 1000,
          pending: false,
        })),
      });
      projectionRepository.findMonthLedger.mockResolvedValue([
        activeMonth('2026-01'),
        activeMonth('2025-12'),
        activeMonth('2025-11'),
      ]);

      const summary = await executeAt(new Date('2026-02-28T12:00:00.000Z'));

      expect(iso(lastQuery().range.end)).toBe('2026-03-01T02:59:59.999Z');
      expect(summary.projection.variableEstimate).toBe(100);
    });

    it('should key the cache by version and local day', async () => {
      await executeAt(NOW);

      expect(cache.set).toHaveBeenCalledWith(
        'report:month-summary:v4:ws-1:2026-09-15',
        expect.any(String),
        300,
      );
    });

    it('should not call the projection repository on a cache hit', async () => {
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
          projection: { expectedIncome: 1, usualExpense: null },
        }),
      );

      await service.execute({ sub: 'user-1', workspaceId: 'ws-1' });

      expect(projectionRepository.findMonthLedger).not.toHaveBeenCalled();
      expect(
        projectionRepository.findActiveRecurringRules,
      ).not.toHaveBeenCalled();
      expect(reportRepository.findMonthSummaryMetrics).not.toHaveBeenCalled();
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
    expect(reportRepository.findMonthSummaryMetrics).not.toHaveBeenCalled();
    expect(accountRepository.findAllByWorkspaceId).not.toHaveBeenCalled();
  });
});
