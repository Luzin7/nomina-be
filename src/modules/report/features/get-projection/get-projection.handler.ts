import { AccountType } from '@constants/enums';
import { CacheProvider } from '@infra/cache/contracts/CacheProvider';
import { AnyAccount } from '@modules/account/entities/types';
import { AccountRepository } from '@modules/account/repositories/contracts/AccountRepository';
import { BudgetRepository } from '@modules/budget/repositories/contracts/BudgetRepository';
import { readGoalGeneration } from '@modules/goal/services/goal-cache';
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
import { Injectable, Logger } from '@nestjs/common';
import { TokenPayloadBase } from '@providers/auth/strategys/jwtStrategy';
import { DateProvider } from '@providers/date/contracts/DateProvider';
import { buildCacheKey } from '@shared/cache/cache-key';
import { readThrough } from '@shared/cache/read-through';
import {
  LEDGER_CACHE_TTL_SECONDS,
  readLedgerGeneration,
} from '@shared/cache/report-cache';
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
  private readonly logger = new Logger(GetProjectionService.name);

  constructor(
    private readonly accountRepository: AccountRepository,
    private readonly monthProjectionRepository: MonthProjectionRepository,
    private readonly budgetRepository: BudgetRepository,
    private readonly workspaceTimezone: GetWorkspaceTimezoneService,
    private readonly dateProvider: DateProvider,
    private readonly cache: CacheProvider,
  ) {}

  async execute({
    workspaceId,
    months,
  }: Request): Promise<Either<Error, Response>> {
    const horizon = months ?? DEFAULT_HORIZON_MONTHS;
    if (!isValidHorizon(horizon)) {
      return left(new InvalidProjectionHorizonError());
    }

    const [ledger, goal] = await Promise.all([
      readLedgerGeneration(this.cache, workspaceId),
      readGoalGeneration(this.cache, workspaceId),
    ]);
    const timezone = await this.workspaceTimezone.execute(workspaceId);
    const localDay = this.dateProvider.format(
      this.dateProvider.now(),
      'YYYY-MM-DD',
      timezone,
    );

    return readThrough({
      cache: this.cache,
      key: buildCacheKey({
        route: 'projection',
        version: 'v1',
        workspaceId,
        generations: { ledger, goal },
        parts: [horizon, localDay],
      }),
      ttlSeconds: LEDGER_CACHE_TTL_SECONDS,
      load: () => this.project(workspaceId, horizon),
    });
  }

  private async project(
    workspaceId: string,
    horizon: number,
  ): Promise<Either<Error, Response>> {
    const startedAt = performance.now();
    let step = 'load-bundle';

    try {
      const bundle = await this.loadBundle(workspaceId, horizon);
      step = 'project-horizon';

      return right({
        projection: projectHorizon(bundle),
        horizon,
        generatedAt: bundle.asOf,
      });
    } catch (error) {
      this.logger.error(
        `get-projection failed step=${step} workspaceId=${workspaceId} months=${horizon} elapsedMs=${Math.round(performance.now() - startedAt)} error=${error instanceof Error ? error.message : String(error)}`,
      );
      throw error;
    }
  }

  private async loadBundle(
    workspaceId: string,
    horizon: number,
  ): Promise<HorizonBundle> {
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

    return {
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
