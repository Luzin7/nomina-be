import { RECURRING_GENERATION_TIMEZONE } from '@constants/timezone';
import { CacheProvider } from '@infra/cache/contracts/CacheProvider';
import { BudgetRepository } from '@modules/budget/repositories/contracts/BudgetRepository';
import { MonthProjectionRepository } from '@modules/report/repositories/contracts/MonthProjectionRepository';
import {
  buildMonthPace,
  expenseOccurrencesByDay,
  MonthPace,
  MonthPlanSource,
} from '@modules/report/valueObjects/MonthPace';
import { GetWorkspaceTimezoneService } from '@modules/workspace/services/get-workspace-timezone.service';
import { Injectable } from '@nestjs/common';
import { TokenPayloadSchema } from '@providers/auth/strategys/jwtStrategy';
import { DateProvider } from '@providers/date/contracts/DateProvider';
import { buildCacheKey } from '@shared/cache/cache-key';
import { readThrough } from '@shared/cache/read-through';
import {
  LEDGER_LIVE_CACHE_TTL_SECONDS,
  readLedgerGeneration,
} from '@shared/cache/report-cache';
import { Service } from '@shared/core/contracts/Service';
import { Either, left, right } from '@shared/core/errors/Either';
import { nextOccurrence } from '@utils/installmentSchedule';
import { daysInMonth } from '@utils/calendarMonth';
import {
  ResolveMonthPlanService,
  type ResolvedMonthPlan,
} from '../../services/resolve-month-plan.service';
import { GetMonthPaceRequest } from './get-month-pace.dto';

type Request = GetMonthPaceRequest & Pick<TokenPayloadSchema, 'workspaceId'>;

const planFieldsOf = (
  plan: ResolvedMonthPlan,
): { planTotalCents: number | null; planSource: MonthPlanSource | null } => {
  if (plan.source === 'declared' || plan.source === 'provisional') {
    return { planTotalCents: plan.planTotalCents, planSource: plan.source };
  }

  return { planTotalCents: null, planSource: null };
};

@Injectable()
export class GetMonthPaceService implements Service<Request, Error, MonthPace> {
  constructor(
    private readonly resolveMonthPlan: ResolveMonthPlanService,
    private readonly budgetRepository: BudgetRepository,
    private readonly monthProjectionRepository: MonthProjectionRepository,
    private readonly workspaceTimezone: GetWorkspaceTimezoneService,
    private readonly dateProvider: DateProvider,
    private readonly cache: CacheProvider,
  ) {}

  async execute(request: Request): Promise<Either<Error, MonthPace>> {
    const { workspaceId, month, year } = request;
    const [ledger, timezone] = await Promise.all([
      readLedgerGeneration(this.cache, workspaceId),
      this.workspaceTimezone.execute(workspaceId),
    ]);
    const now = this.dateProvider.now();

    return readThrough({
      cache: this.cache,
      key: buildCacheKey({
        route: 'report:month-pace',
        version: 'v2',
        workspaceId,
        generations: { ledger },
        parts: [
          `${year}-${month}`,
          this.dateProvider.format(now, 'YYYY-MM-DD', timezone),
        ],
      }),
      ttlSeconds: LEDGER_LIVE_CACHE_TTL_SECONDS,
      load: () => this.compute(request, now, timezone),
    });
  }

  private async compute(
    { workspaceId, month, year }: Request,
    now: Date,
    timezone: string,
  ): Promise<Either<Error, MonthPace>> {
    const monthKey = `${year}-${String(month).padStart(2, '0')}`;
    const referenceDate = `${monthKey}-01`;
    const start = this.dateProvider.startOfMonth(referenceDate, timezone);
    const end = this.dateProvider.endOfMonth(referenceDate, timezone);
    const totalDays = daysInMonth(year, month);

    const [plan, spentRows, rules] = await Promise.all([
      this.resolveMonthPlan.execute({
        workspaceId,
        month,
        year,
        today: this.dateProvider.format(now, 'YYYY-MM-DD', timezone),
      }),
      this.budgetRepository.findCompletedExpenseByLocalDay({
        workspaceId,
        start,
        end,
        timezone,
      }),
      this.monthProjectionRepository.findActiveRecurringRules(workspaceId, {
        start,
        end,
      }),
    ]);

    if (plan.isLeft()) return left(plan.value);

    return right(
      buildMonthPace({
        month: monthKey,
        daysInMonth: totalDays,
        today: this.resolveToday(monthKey, now, timezone, totalDays),
        spentByDay: Object.fromEntries(
          spentRows.map(({ day, totalCents }) => [day, totalCents]),
        ),
        ...planFieldsOf(plan.value),
        fixedByDay: expenseOccurrencesByDay({
          rules,
          month: { start, end },
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
          dayOf: (date) =>
            Number(this.dateProvider.format(date, 'D', timezone)),
        }),
      }),
    );
  }

  private resolveToday(
    monthKey: string,
    now: Date,
    timezone: string,
    totalDays: number,
  ): number {
    const currentKey = this.dateProvider.format(now, 'YYYY-MM', timezone);
    if (monthKey > currentKey) return 0;
    if (monthKey < currentKey) return totalDays;

    return Number(this.dateProvider.format(now, 'D', timezone));
  }
}
