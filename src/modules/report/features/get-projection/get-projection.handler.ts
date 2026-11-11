import { AccountType } from '@constants/enums';
import { AnyAccount } from '@modules/account/entities/types';
import { AccountRepository } from '@modules/account/repositories/contracts/AccountRepository';
import { BudgetRepository } from '@modules/budget/repositories/contracts/BudgetRepository';
import { InvalidProjectionHorizonError } from '@modules/report/errors';
import { MonthProjectionRepository } from '@modules/report/repositories/contracts/MonthProjectionRepository';
import {
  HorizonBundle,
  HorizonMonthWindow,
  HorizonProjection,
  projectHorizon,
} from '@modules/report/valueObjects/ProjectionHorizon';
import { LOOKBACK_MONTHS } from '@modules/report/valueObjects/ProjectionRules';
import { GetWorkspaceTimezoneService } from '@modules/workspace/services/get-workspace-timezone.service';
import { Injectable } from '@nestjs/common';
import { TokenPayloadBase } from '@providers/auth/strategys/jwtStrategy';
import { DateProvider } from '@providers/date/contracts/DateProvider';
import { Service } from '@shared/core/contracts/Service';
import { Either, left, right } from '@shared/core/errors/Either';
import { GetProjectionRequest } from './get-projection.dto';

export const DEFAULT_HORIZON_MONTHS = 6;
const MIN_HORIZON_MONTHS = 1;
const MAX_HORIZON_MONTHS = 12;

type Request = GetProjectionRequest & Pick<TokenPayloadBase, 'workspaceId'>;

type Response = {
  projection: HorizonProjection;
  horizon: number;
  generatedAt: Date;
};

const isCashAccount = (account: AnyAccount): boolean =>
  account.type === AccountType.CHECKING || account.type === AccountType.CASH;

const openingBalanceCents = (accounts: AnyAccount[]): number =>
  accounts
    .filter(isCashAccount)
    .reduce((total, account) => total + Number(account.balance), 0);

const isValidHorizon = (months: number): boolean =>
  Number.isInteger(months) &&
  months >= MIN_HORIZON_MONTHS &&
  months <= MAX_HORIZON_MONTHS;

@Injectable()
export class GetProjectionService implements Service<Request, Error, Response> {
  constructor(
    private readonly accountRepository: AccountRepository,
    private readonly monthProjectionRepository: MonthProjectionRepository,
    private readonly budgetRepository: BudgetRepository,
    private readonly workspaceTimezone: GetWorkspaceTimezoneService,
    private readonly dateProvider: DateProvider,
  ) {}

  async execute({
    workspaceId,
    months,
  }: Request): Promise<Either<Error, Response>> {
    const horizon = months ?? DEFAULT_HORIZON_MONTHS;
    if (!isValidHorizon(horizon)) {
      return left(new InvalidProjectionHorizonError());
    }

    const now = this.dateProvider.now();
    const timezone = await this.workspaceTimezone.execute(workspaceId);
    const currentMonthStart = this.dateProvider.startOfMonth(now, timezone);
    const windows = this.monthWindows(currentMonthStart, horizon, timezone);
    const firstMonth = windows[0];
    const lastMonth = windows[windows.length - 1];
    const ledgerStart = this.dateProvider.startOfMonth(
      this.dateProvider.add(
        currentMonthStart,
        -LOOKBACK_MONTHS,
        'month',
        timezone,
      ),
      timezone,
    );

    const [
      accounts,
      ledger,
      recurringRules,
      pendingInstallments,
      budgetSnapshots,
    ] = await Promise.all([
      this.accountRepository.findAllByWorkspaceId(workspaceId),
      this.monthProjectionRepository.findMonthLedger({
        workspaceId,
        timezone,
        range: { start: ledgerStart, end: lastMonth.end },
        currentMonthStart,
      }),
      this.monthProjectionRepository.findActiveRecurringRules(workspaceId, {
        start: firstMonth.start,
        end: lastMonth.end,
      }),
      this.monthProjectionRepository.findPendingInstallments(workspaceId, {
        start: firstMonth.start,
        end: lastMonth.end,
      }),
      this.budgetRepository.resolveSnapshots(
        workspaceId,
        windows.map((month) => month.start),
      ),
    ]);

    const bundle: HorizonBundle = {
      months: windows,
      asOf: now,
      timezone,
      openingBalanceCents: openingBalanceCents(accounts),
      ledger,
      recurringRules,
      pendingInstallments,
      budgetSnapshots: budgetSnapshots.map(({ monthStart, snapshot }) => ({
        monthKey: this.dateProvider.format(monthStart, 'YYYY-MM', timezone),
        snapshot,
      })),
    };

    return right({
      projection: projectHorizon(bundle),
      horizon,
      generatedAt: now,
    });
  }

  private monthWindows(
    currentMonthStart: Date,
    horizon: number,
    timezone: string,
  ): HorizonMonthWindow[] {
    return Array.from({ length: horizon }, (_, index) => {
      const reference = this.dateProvider.add(
        currentMonthStart,
        index,
        'month',
        timezone,
      );
      const start = this.dateProvider.startOfMonth(reference, timezone);
      const end = this.dateProvider.endOfMonth(reference, timezone);

      return {
        key: this.dateProvider.format(start, 'YYYY-MM', timezone),
        start,
        end,
        days: Number(this.dateProvider.format(end, 'D', timezone)),
      };
    });
  }
}
