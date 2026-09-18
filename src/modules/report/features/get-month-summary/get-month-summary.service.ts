import { AccountType } from '@constants/enums';
import { CacheProvider } from '@infra/cache/contracts/CacheProvider';
import { AnyAccount } from '@modules/account/entities/types';
import { AccountRepository } from '@modules/account/repositories/contracts/AccountRepository';
import { TransactionRepository } from '@modules/transaction/repositories/contracts/TransactionRepository';
import { MonthSummary } from '@modules/transaction/valueObjects/MonthSumarryWithPercentage';
import { GetWorkspaceTimezoneService } from '@modules/workspace/services/get-workspace-timezone.service';
import { HttpException, Injectable } from '@nestjs/common';
import { TokenPayloadBase } from '@providers/auth/strategys/jwtStrategy';
import { DateProvider } from '@providers/date/contracts/DateProvider';
import { Service } from '@shared/core/contracts/Service';
import { Either, right } from '@shared/core/errors/Either';

type Request = TokenPayloadBase;

type Errors = HttpException;

type Response = MonthSummary;

const CACHE_TTL = 5 * 60;

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
    private readonly workspaceTimezone: GetWorkspaceTimezoneService,
    private readonly dateProvider: DateProvider,
    private readonly cache: CacheProvider,
  ) {}

  async execute({ workspaceId }: Request): Promise<Either<Errors, Response>> {
    const now = this.dateProvider.now();
    const timezone = await this.workspaceTimezone.execute(workspaceId);

    const currentMonthStart = this.dateProvider.startOfMonth(now, timezone);
    const cacheKey = `report:month-summary:${workspaceId}:${this.dateProvider.format(currentMonthStart, 'YYYY-MM', timezone)}`;
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

    const [currentMonthData, previousMonthData, accounts] = await Promise.all([
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
      this.accountRepository.findAllByWorkspaceId(workspaceId),
    ]);

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
      }),
      CACHE_TTL,
    );

    return right(monthSummary);
  }
}
