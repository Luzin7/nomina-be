import { AccountType } from '@constants/enums';
import { RECURRING_GENERATION_TIMEZONE } from '@constants/timezone';
import { CacheProvider } from '@infra/cache/contracts/CacheProvider';
import { AnyAccount } from '@modules/account/entities/types';
import { AccountRepository } from '@modules/account/repositories/contracts/AccountRepository';
import { TransactionRepository } from '@modules/transaction/repositories/contracts/TransactionRepository';
import {
  DateRange,
  MonthProjectionRepository,
} from '@modules/report/repositories/contracts/MonthProjectionRepository';
import { projectMonthEnd } from '@modules/report/valueObjects/MonthProjection';
import { LOOKBACK_MONTHS } from '@modules/report/valueObjects/ProjectionRules';
import { MonthSummary } from '@modules/report/valueObjects/MonthSummary';
import { GetWorkspaceTimezoneService } from '@modules/workspace/services/get-workspace-timezone.service';
import { HttpException, Injectable } from '@nestjs/common';
import { TokenPayloadBase } from '@providers/auth/strategys/jwtStrategy';
import { DateProvider } from '@providers/date/contracts/DateProvider';
import { Service } from '@shared/core/contracts/Service';
import { Either, right } from '@shared/core/errors/Either';
import { nextOccurrence } from '@utils/installmentSchedule';

type Request = TokenPayloadBase;

type Errors = HttpException;

type Response = MonthSummary;

const CACHE_TTL = 5 * 60;

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
    private readonly transactionRepository: TransactionRepository,
    private readonly accountRepository: AccountRepository,
    private readonly monthProjectionRepository: MonthProjectionRepository,
    private readonly workspaceTimezone: GetWorkspaceTimezoneService,
    private readonly dateProvider: DateProvider,
    private readonly cache: CacheProvider,
  ) {}

  async execute({ workspaceId }: Request): Promise<Either<Errors, Response>> {
    const now = this.dateProvider.now();
    const timezone = await this.workspaceTimezone.execute(workspaceId);

    const currentMonthStart = this.dateProvider.startOfMonth(now, timezone);
    const cacheKey = `report:month-summary:v4:${workspaceId}:${this.dateProvider.format(now, 'YYYY-MM-DD', timezone)}`;
    const cached = await this.cache.get(cacheKey);
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

    const [
      currentMonthData,
      previousMonthData,
      previousMonthToDateData,
      accounts,
      ledger,
      recurringRules,
    ] = await Promise.all([
      this.transactionRepository.sumTransactionsByDateRange(
        workspaceId,
        currentMonthStart,
        currentMonthEnd,
      ),
      this.transactionRepository.sumTransactionsByDateRange(
        workspaceId,
        previousMonthStart,
        previousMonthEnd,
      ),
      this.transactionRepository.sumTransactionsByDateRange(
        workspaceId,
        previousMonthStart,
        previousMonthToDateEnd,
      ),
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
        totalIncome: currentMonthData.totalIncome,
        totalExpense: currentMonthData.totalExpense,
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
      totalIncome: currentMonthData.totalIncome,
      totalExpense: currentMonthData.totalExpense,
      ...aggregateAccountBalances(accounts),
      rate: {
        currentMonthSaving: calculateSavingRate(
          currentMonthData.totalIncome,
          currentMonthData.totalExpense,
        ),
        previousMonthCompareSaving: calculatePercentageChange(
          currentMonthData.totalIncome - currentMonthData.totalExpense,
          previousMonthData.totalIncome - previousMonthData.totalExpense,
        ),
      },
      previousMonthToDate: {
        totalIncome: previousMonthToDateData.totalIncome,
        totalExpense: previousMonthToDateData.totalExpense,
      },
      projection,
    });

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
      CACHE_TTL,
    );

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
