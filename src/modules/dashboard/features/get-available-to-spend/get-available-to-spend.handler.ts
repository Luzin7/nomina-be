import { readCategoryGeneration } from '@modules/category/services/category-list-cache';
import { CacheProvider } from '@infra/cache/contracts/CacheProvider';
import { GetBudgetStatusService } from '@modules/budget/features/get-status/get-status.handler';
import type { BudgetStatusResponse } from '@modules/budget/features/get-status/get-status.handler';
import type { MonthProjection } from '@modules/report/valueObjects/MonthProjection';
import { readGoalGeneration } from '@modules/goal/services/goal-cache';
import { GoalRepository } from '@modules/goal/repositories/contracts/GoalRepository';
import { FindMonthSummaryService } from '@modules/report/features/get-month-summary/get-month-summary.service';
import { GetWorkspaceTimezoneService } from '@modules/workspace/services/get-workspace-timezone.service';
import { Injectable, Logger } from '@nestjs/common';
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
import { CardBillDueInsightService } from '../../services/card-bill-due-insight.service';
import {
  resolveInsight,
  type InsightSource,
} from '../../services/insight-source-guard';
import { ProjectionShortfallInsightService } from '../../services/projection-shortfall-insight.service';
import {
  buildSpendableFigure,
  type AvailableToSpendInsight,
  type AvailableToSpendResponse,
  type SpendableFigure,
} from '../../valueObjects/AvailableToSpend';
import {
  categoryBreachInsight,
  overBudgetInsight,
  unallocatedIncomeInsight,
} from '../../valueObjects/BudgetInsights';

type Request = Pick<TokenPayloadSchema, 'workspaceId' | 'sub'>;

type InsightContext = Request & {
  budget: BudgetStatusResponse;
  figure: SpendableFigure;
  today: string;
};

const sync =
  (read: () => AvailableToSpendInsight | null) =>
  async (): Promise<AvailableToSpendInsight | null> =>
    read();

@Injectable()
export class GetAvailableToSpendService implements Service<
  Request,
  Error,
  AvailableToSpendResponse
> {
  private readonly logger = new Logger(GetAvailableToSpendService.name);

  constructor(
    private readonly getBudgetStatus: GetBudgetStatusService,
    private readonly findMonthSummary: FindMonthSummaryService,
    private readonly goalRepository: GoalRepository,
    private readonly cardBillDueInsight: CardBillDueInsightService,
    private readonly projectionShortfallInsight: ProjectionShortfallInsightService,
    private readonly workspaceTimezone: GetWorkspaceTimezoneService,
    private readonly dateProvider: DateProvider,
    private readonly cache: CacheProvider,
  ) {}

  async execute(
    request: Request,
  ): Promise<Either<Error, AvailableToSpendResponse>> {
    const { workspaceId } = request;
    const [ledger, goal, category] = await Promise.all([
      readLedgerGeneration(this.cache, workspaceId),
      readGoalGeneration(this.cache, workspaceId),
      readCategoryGeneration(this.cache, workspaceId),
    ]);
    const timezone = await this.workspaceTimezone.execute(workspaceId);
    const today = this.dateProvider.format(
      this.dateProvider.now(),
      'YYYY-MM-DD',
      timezone,
    );

    return readThrough({
      cache: this.cache,
      key: buildCacheKey({
        route: 'dashboard:available-to-spend',
        version: 'v2',
        workspaceId,
        generations: { ledger, goal, category },
        parts: [today],
      }),
      ttlSeconds: LEDGER_LIVE_CACHE_TTL_SECONDS,
      load: () => this.compute(request, today),
    });
  }

  private async compute(
    { workspaceId, sub }: Request,
    today: string,
  ): Promise<Either<Error, AvailableToSpendResponse>> {
    const [year, month] = today.split('-').map(Number);

    const [budget, goalAportesCents] = await Promise.all([
      this.getBudgetStatus.execute({ workspaceId, sub, month, year }),
      this.goalRepository.sumMonthlyAporteCents(workspaceId),
    ]);
    if (budget.isLeft()) return left(budget.value);

    const projectionResult = await this.currentProjectionOf(budget.value, {
      workspaceId,
      sub,
    });
    if (projectionResult.isLeft()) return left(projectionResult.value);

    const projection = projectionResult.value;
    const figure = buildSpendableFigure({
      budget: budget.value,
      recurringNotYetGeneratedCents:
        projection.recurringNotYetGenerated.totalExpense,
      goalAportesCents,
      daysRemaining: projection.daysRemaining,
    });
    const insight = await this.rankInsight({
      workspaceId,
      sub,
      budget: budget.value,
      figure,
      today,
    });

    return right({
      month: today.slice(0, 7),
      daysRemaining: projection.daysRemaining,
      ...figure,
      insight,
    });
  }

  private async currentProjectionOf(
    budget: BudgetStatusResponse,
    identity: Request,
  ): Promise<Either<Error, MonthProjection>> {
    if (budget.exists && budget.projection) return right(budget.projection);

    const summary = await this.findMonthSummary.execute(identity);
    if (summary.isLeft()) return left(summary.value);

    return right(summary.value.projection);
  }

  private async rankInsight(
    context: InsightContext,
  ): Promise<AvailableToSpendInsight | null> {
    const { insight, failures } = await resolveInsight(
      this.insightSourcesOf(context),
    );

    for (const { code, error } of failures) {
      this.logger.warn(
        `insight source failed code=${code} workspaceId=${context.workspaceId} error=${error instanceof Error ? error.constructor.name : typeof error}`,
      );
    }

    return insight;
  }

  private insightSourcesOf({
    workspaceId,
    sub,
    budget,
    figure,
    today,
  }: InsightContext): InsightSource[] {
    return [
      {
        code: 'OVER_BUDGET',
        resolve: sync(() => overBudgetInsight(figure.spendableCents)),
      },
      {
        code: 'CARD_BILL_DUE',
        resolve: () =>
          this.cardBillDueInsight.execute({ workspaceId, sub, today }),
      },
      {
        code: 'PROJECTION_SHORTFALL',
        resolve: () => this.projectionShortfallInsight.execute({ workspaceId }),
      },
      {
        code: 'CATEGORY_BREACH',
        resolve: sync(() => categoryBreachInsight(budget)),
      },
      {
        code: 'UNALLOCATED_INCOME',
        resolve: sync(() => unallocatedIncomeInsight(budget)),
      },
    ];
  }
}
