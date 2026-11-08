import { AccountType } from '@constants/enums';
import { RECURRING_GENERATION_TIMEZONE } from '@constants/timezone';
import { CacheProvider } from '@infra/cache/contracts/CacheProvider';
import { AnyAccount } from '@modules/account/entities/types';
import { AccountRepository } from '@modules/account/repositories/contracts/AccountRepository';
import {
  DateRange,
  MonthProjectionRepository,
} from '@modules/report/repositories/contracts/MonthProjectionRepository';
import { ReportRepository } from '@modules/report/repositories/contracts/ReportRepository';
import { projectMonthEnd } from '@modules/report/valueObjects/MonthProjection';
import { MonthSummary } from '@modules/report/valueObjects/MonthSummary';
import { LOOKBACK_MONTHS } from '@modules/report/valueObjects/ProjectionRules';
import { GetWorkspaceTimezoneService } from '@modules/workspace/services/get-workspace-timezone.service';
import { HttpException, Injectable } from '@nestjs/common';
import { TokenPayloadBase } from '@providers/auth/strategys/jwtStrategy';
import { DateProvider } from '@providers/date/contracts/DateProvider';
import { Service } from '@shared/core/contracts/Service';
import {
  REPORT_CACHE_TTL_SECONDS,
  readReportGeneration,
} from '@shared/cache/report-cache';
import { Either, right } from '@shared/core/errors/Either';
import { nextOccurrence } from '@utils/installmentSchedule';

type Request = TokenPayloadBase;

type Errors = HttpException;

type Response = MonthSummary;

type ProjectionWindows = {
  currentMonth: DateRange;
  ledgerRange: DateRange;
  monthKey: string;
  dayOfMonth: number;
  days: number;
};

type AccountBalances = {
  totalCheckingBalance: number;
  totalInvestmentBalance: number;
  totalCreditCardBalance: number;
};

function aggregateAccountBalances(accounts: AnyAccount[]): AccountBalances {
  const balances: AccountBalances = {
    totalCheckingBalance: 0,
    totalInvestmentBalance: 0,
    totalCreditCardBalance: 0,
  };

  for (const account of accounts) {
    const balance = Number(account.balance);

    switch (account.type) {
      case AccountType.CHECKING:
      case AccountType.CASH:
        balances.totalCheckingBalance += balance;
        break;
      case AccountType.INVESTMENT:
        balances.totalInvestmentBalance += balance;
        break;
      case AccountType.CREDIT_CARD:
        balances.totalCreditCardBalance += balance;
        break;
    }
  }

  return balances;
}

function calculatePercentageChange(current: number, previous: number): number {
  if (previous === 0) return current > 0 ? 100 : 0;

  return ((current - previous) / previous) * 100;
}

function calculateSavingRate(
  totalIncome: number,
  totalExpense: number,
): number {
  if (totalIncome <= 0) return 0;

  return Math.round(((totalIncome - totalExpense) / totalIncome) * 100);
}

@Injectable()
export class FindMonthSummaryService implements Service<
  Request,
  Errors,
  Response
> {
  constructor(
    private readonly reportRepository: ReportRepository,
    private readonly accountRepository: AccountRepository,
    private readonly monthProjectionRepository: MonthProjectionRepository,
    private readonly workspaceTimezone: GetWorkspaceTimezoneService,
    private readonly dateProvider: DateProvider,
    private readonly cache: CacheProvider,
  ) {}

  async execute({ workspaceId }: Request): Promise<Either<Errors, Response>> {
    const generation = await readReportGeneration(this.cache, workspaceId);
    const now = this.dateProvider.now();
    const timezone = await this.workspaceTimezone.execute(workspaceId);

    const currentMonthStart = this.dateProvider.startOfMonth(now, timezone);
    const cacheKey =
      generation === null
        ? null
        : `report:month-summary:v8:${workspaceId}:g${generation}:${this.dateProvider.format(now, 'YYYY-MM-DD', timezone)}`;
    const cached = cacheKey ? await this.cache.get(cacheKey) : null;
    if (cached) {
      const parsed = JSON.parse(cached);
      return right(
        MonthSummary.create({
          ...parsed,
          month: new Date(parsed.month),
          totalCheckingBalance: parsed.totalCheckingBalance ?? 0,
          totalInvestmentBalance: parsed.totalInvestmentBalance ?? 0,
          totalCreditCardBalance: parsed.totalCreditCardBalance ?? 0,
          projection: parsed.projection,
        }),
      );
    }

    const currentMonthEnd = this.dateProvider.endOfMonth(now, timezone);
    const previousMonthReference = this.dateProvider.add(
      currentMonthStart,
      -1,
      'month',
      timezone,
    );
    const previousMonthStart = this.dateProvider.startOfMonth(
      previousMonthReference,
      timezone,
    );
    const previousMonthEnd = this.dateProvider.endOfMonth(
      previousMonthReference,
      timezone,
    );

    const previousMonthToDateEnd = this.previousMonthToDateEnd(
      now,
      previousMonthStart,
      previousMonthEnd,
      timezone,
    );

    const windows = this.projectionWindows(
      now,
      { start: currentMonthStart, end: currentMonthEnd },
      timezone,
    );

    const [summaryMetrics, accounts, ledger, recurringRules] =
      await Promise.all([
        this.reportRepository.findMonthSummaryMetrics(workspaceId, {
          currentStart: currentMonthStart,
          currentEnd: currentMonthEnd,
          prevStart: previousMonthStart,
          prevEnd: previousMonthEnd,
          prevMtdEnd: previousMonthToDateEnd,
        }),
        this.accountRepository.findAllByWorkspaceId(workspaceId),
        this.monthProjectionRepository.findMonthLedger({
          workspaceId,
          timezone,
          range: windows.ledgerRange,
          currentMonthStart,
        }),
        this.monthProjectionRepository.findActiveRecurringRules(
          workspaceId,
          windows.currentMonth,
        ),
      ]);

    const projection = projectMonthEnd({
      month: {
        ...windows.currentMonth,
        key: windows.monthKey,
        days: windows.days,
      },
      dayOfMonth: windows.dayOfMonth,
      realized: {
        totalIncome: summaryMetrics.currentMonthData.totalIncome,
        totalExpense: summaryMetrics.currentMonthData.totalExpense,
      },
      ledger,
      recurringRules,
      nextOccurrence: (date, rule) =>
        nextOccurrence(
          {
            startDate: date,
            frequency: rule.frequency,
            interval: rule.interval,
            timezone: RECURRING_GENERATION_TIMEZONE,
          },
          this.dateProvider,
        ),
    });

    const monthSummary = MonthSummary.create({
      month: currentMonthStart,
      totalIncome: summaryMetrics.currentMonthData.totalIncome,
      totalExpense: summaryMetrics.currentMonthData.totalExpense,
      ...aggregateAccountBalances(accounts),
      rate: {
        currentMonthSaving: calculateSavingRate(
          summaryMetrics.currentMonthData.totalIncome,
          summaryMetrics.currentMonthData.totalExpense,
        ),
        previousMonthCompareSaving: calculatePercentageChange(
          summaryMetrics.currentMonthData.totalIncome -
            summaryMetrics.currentMonthData.totalExpense,
          summaryMetrics.previousMonthData.totalIncome -
            summaryMetrics.previousMonthData.totalExpense,
        ),
      },
      previousMonthToDate: {
        totalIncome: summaryMetrics.previousMonthToDateData.totalIncome,
        totalExpense: summaryMetrics.previousMonthToDateData.totalExpense,
      },
      projection,
    });

    if (cacheKey) {
      await this.cache.set(
        cacheKey,
        JSON.stringify({
          month: monthSummary.month,
          totalIncome: monthSummary.totalIncome,
          totalExpense: monthSummary.totalExpense,
          totalCheckingBalance: monthSummary.totalCheckingBalance,
          totalInvestmentBalance: monthSummary.totalInvestmentBalance,
          totalCreditCardBalance: monthSummary.totalCreditCardBalance,
          rate: monthSummary.rate,
          previousMonthToDate: monthSummary.previousMonthToDate,
          projection: monthSummary.projection,
        }),
        REPORT_CACHE_TTL_SECONDS,
      );
    }

    return right(monthSummary);
  }

  private previousMonthToDateEnd(
    now: Date,
    previousMonthStart: Date,
    previousMonthEnd: Date,
    timezone: string,
  ): Date {
    const dayOfMonth = Number(this.dateProvider.format(now, 'D', timezone));
    const sameDay = this.dateProvider.add(
      previousMonthStart,
      dayOfMonth - 1,
      'day',
      timezone,
    );
    const sameDayEnd = this.dateProvider.endOfDay(sameDay, timezone);

    return sameDayEnd > previousMonthEnd ? previousMonthEnd : sameDayEnd;
  }

  private projectionWindows(
    now: Date,
    currentMonth: DateRange,
    timezone: string,
  ): ProjectionWindows {
    const lookbackReference = this.dateProvider.add(
      currentMonth.start,
      -LOOKBACK_MONTHS,
      'month',
      timezone,
    );

    return {
      currentMonth,
      ledgerRange: {
        start: this.dateProvider.startOfMonth(lookbackReference, timezone),
        end: currentMonth.end,
      },
      monthKey: this.dateProvider.format(
        currentMonth.start,
        'YYYY-MM',
        timezone,
      ),
      dayOfMonth: Number(this.dateProvider.format(now, 'D', timezone)),
      days: Number(this.dateProvider.format(currentMonth.end, 'D', timezone)),
    };
  }
}
