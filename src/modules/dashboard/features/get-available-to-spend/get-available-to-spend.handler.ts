import { readCategoryGeneration } from '@modules/category/services/category-list-cache';
import { normalizeWorkspaceCycle } from '@constants/enums';
import { CacheProvider } from '@infra/cache/contracts/CacheProvider';
import { GetBudgetStatusService } from '@modules/budget/features/get-status/get-status.handler';
import type { BudgetStatusResponse } from '@modules/budget/features/get-status/get-status.handler';
import {
  ResolveMonthPlanService,
  type ResolvedMonthPlan,
} from '@modules/report/services/resolve-month-plan.service';
import type { MonthProjection } from '@modules/report/valueObjects/MonthProjection';
import { readGoalGeneration } from '@modules/goal/services/goal-cache';
import { GoalRepository } from '@modules/goal/repositories/contracts/GoalRepository';
import { FindMonthSummaryService } from '@modules/report/features/get-month-summary/get-month-summary.service';
import { GetSpendableService } from '@modules/spendable/features/get-spendable/get-spendable.handler';
import { CycleWindow } from '@modules/spendable/valueObjects/CycleWindow';
import type { SpendablePayload } from '@modules/spendable/presenters/Spendable.presenter';
import { SpendableRepository } from '@modules/spendable/repositories/contracts/SpendableRepository';
import { GetWorkspaceTimezoneService } from '@modules/workspace/services/get-workspace-timezone.service';
import { Injectable, Logger } from '@nestjs/common';
import { captureException } from '@sentry/nestjs';
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
import { describeError } from '@modules/dashboard/services/describe-error';
import { CardBillDueInsightService } from '../../services/card-bill-due-insight.service';
import {
  resolveInsight,
  type InsightSource,
} from '../../services/insight-source-guard';
import { BudgetSuggestionInsightService } from '../../services/budget-suggestion-insight.service';
import { ProjectionShortfallInsightService } from '../../services/projection-shortfall-insight.service';
import {
  buildSpendableFigure,
  planSidesOf,
  type AvailableToSpendInsight,
  type AvailableToSpendResponse,
  type SpendableFigure,
} from '../../valueObjects/AvailableToSpend';
import {
  categoryBreachInsight,
  overBudgetInsight,
  unallocatedIncomeInsight,
} from '../../valueObjects/BudgetInsights';

const DEGRADED_CACHE_TTL_SECONDS = 60;

type ComputedAvailableToSpend = {
  response: AvailableToSpendResponse;
  degraded: boolean;
};

type RankedInsight = {
  insight: AvailableToSpendInsight | null;
  degraded: boolean;
};

type SpendableOutcome = {
  spendable: SpendablePayload | null;
  failed: boolean;
};

type Request = Pick<TokenPayloadSchema, 'workspaceId' | 'sub'>;

type ComputeStep =
  | 'budget'
  | 'plan'
  | 'goalAportes'
  | 'spendable'
  | 'projection';

type ComputeTimings = Record<ComputeStep, number>;

type InsightContext = Request & {
  budget: BudgetStatusResponse;
  figure: SpendableFigure;
  today: string;
};

const isDegradedPlan = (plan: ResolvedMonthPlan): boolean =>
  'degraded' in plan && plan.degraded === true;

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
    private readonly resolveMonthPlan: ResolveMonthPlanService,
    private readonly findMonthSummary: FindMonthSummaryService,
    private readonly goalRepository: GoalRepository,
    private readonly cardBillDueInsight: CardBillDueInsightService,
    private readonly projectionShortfallInsight: ProjectionShortfallInsightService,
    private readonly budgetSuggestionInsight: BudgetSuggestionInsightService,
    private readonly getSpendable: GetSpendableService,
    private readonly spendableRepository: SpendableRepository,
    private readonly workspaceTimezone: GetWorkspaceTimezoneService,
    private readonly dateProvider: DateProvider,
    private readonly cache: CacheProvider,
  ) {}

  async execute(
    request: Request,
  ): Promise<Either<Error, AvailableToSpendResponse>> {
    const { workspaceId } = request;
    const [ledger, goal, category, cycle] = await Promise.all([
      readLedgerGeneration(this.cache, workspaceId),
      readGoalGeneration(this.cache, workspaceId),
      readCategoryGeneration(this.cache, workspaceId),
      this.spendableRepository.findCycle(workspaceId),
    ]);
    const timezone = await this.workspaceTimezone.execute(workspaceId);
    const today = this.dateProvider.format(
      this.dateProvider.now(),
      'YYYY-MM-DD',
      timezone,
    );

    const result = await readThrough({
      cache: this.cache,
      key: buildCacheKey({
        route: 'dashboard:available-to-spend',
        version: 'v10',
        workspaceId,
        generations: { ledger, goal, category },
        parts: [today, cycle ?? 'unset'],
      }),
      ttlSeconds: LEDGER_LIVE_CACHE_TTL_SECONDS,
      load: () => this.compute(request, today, cycle),
      ttlFor: ({ degraded }) =>
        degraded ? DEGRADED_CACHE_TTL_SECONDS : LEDGER_LIVE_CACHE_TTL_SECONDS,
    });
    if (result.isLeft()) return left(result.value);

    return right(result.value.response);
  }

  private async compute(
    { workspaceId, sub }: Request,
    today: string,
    cycle: string | null,
  ): Promise<Either<Error, ComputedAvailableToSpend>> {
    const [year, month] = today.split('-').map(Number);
    const daysRemaining = CycleWindow.of(
      today,
      normalizeWorkspaceCycle(cycle),
    ).daysRemaining;
    const startedAt = performance.now();
    const timings: ComputeTimings = {
      budget: 0,
      plan: 0,
      goalAportes: 0,
      spendable: 0,
      projection: 0,
    };

    const [budget, plan, goalAportesCents, spendable] = await Promise.all([
      this.timeStep(timings, 'budget', () =>
        this.getBudgetStatus.execute({ workspaceId, sub, month, year }),
      ),
      this.timeStep(timings, 'plan', () =>
        this.resolveMonthPlan.execute({ workspaceId, month, year, today }),
      ),
      this.timeStep(timings, 'goalAportes', () =>
        this.goalRepository.sumMonthlyAporteCents(workspaceId),
      ),
      this.timeStep(timings, 'spendable', () => this.spendableOf(workspaceId)),
    ]);
    if (budget.isLeft()) return left(budget.value);
    if (plan.isLeft()) return left(plan.value);

    const projectionResult = await this.timeStep(timings, 'projection', () =>
      this.currentProjectionOf(budget.value, { workspaceId, sub }),
    );
    if (projectionResult.isLeft()) return left(projectionResult.value);

    const projection = projectionResult.value;
    const figure = buildSpendableFigure({
      budget: budget.value,
      plan: plan.value,
      recurringNotYetGeneratedCents:
        projection.recurringNotYetGenerated.totalExpense,
      goalAportesCents,
      daysRemaining,
    });
    const ranked = await this.rankInsight({
      workspaceId,
      sub,
      budget: budget.value,
      figure,
      today,
    });

    this.logger.log(
      `available-to-spend compute workspaceId=${workspaceId} budgetMs=${timings.budget} planMs=${timings.plan} goalAportesMs=${timings.goalAportes} spendableMs=${timings.spendable} projectionMs=${timings.projection} totalMs=${Math.round(performance.now() - startedAt)}`,
    );

    return right({
      degraded:
        ranked.degraded || isDegradedPlan(plan.value) || spendable.failed,
      response: {
        month: today.slice(0, 7),
        daysRemaining,
        ...figure,
        ...planSidesOf(budget.value),
        unbudgetedCategories: budget.value.exists
          ? budget.value.unbudgetedCategories
          : [],
        insight: ranked.insight,
        spendable: spendable.spendable,
      },
    });
  }

  private async timeStep<T>(
    timings: ComputeTimings,
    step: ComputeStep,
    run: () => Promise<T>,
  ): Promise<T> {
    const startedAt = performance.now();

    try {
      return await run();
    } finally {
      timings[step] = Math.round(performance.now() - startedAt);
    }
  }

  private async spendableOf(workspaceId: string): Promise<SpendableOutcome> {
    try {
      const result = await this.getSpendable.execute({ workspaceId });
      if (result.isLeft()) return { spendable: null, failed: true };

      return { spendable: result.value, failed: false };
    } catch (error) {
      this.logger.warn(
        `spendable failed workspaceId=${workspaceId} error=${describeError(error)}`,
      );
      captureException(error, { extra: { workspaceId } });
      return { spendable: null, failed: true };
    }
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

  private async rankInsight(context: InsightContext): Promise<RankedInsight> {
    const { insight, failures } = await resolveInsight(
      this.insightSourcesOf(context),
    );

    for (const { code, error } of failures) {
      this.logger.warn(
        `insight source failed code=${code} workspaceId=${context.workspaceId} error=${describeError(error)}`,
      );
    }

    return { insight, degraded: failures.length > 0 };
  }

  private insightSourcesOf({
    workspaceId,
    sub,
    budget,
    today,
  }: InsightContext): InsightSource[] {
    return [
      {
        code: 'OVER_BUDGET',
        resolve: sync(() =>
          overBudgetInsight(budget.exists ? budget.overPlanCents : null),
        ),
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
      {
        code: 'BUDGET_SUGGESTION_READY',
        resolve: () => this.budgetSuggestionInsight.execute({ workspaceId }),
      },
    ];
  }
}
