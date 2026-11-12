import { GetBudgetStatusService } from '@modules/budget/features/get-status/get-status.handler';
import type { BudgetStatusResponse } from '@modules/budget/features/get-status/get-status.handler';
import { GoalRepository } from '@modules/goal/repositories/contracts/GoalRepository';
import { FindMonthSummaryService } from '@modules/report/features/get-month-summary/get-month-summary.service';
import { GetWorkspaceTimezoneService } from '@modules/workspace/services/get-workspace-timezone.service';
import { Injectable, Logger } from '@nestjs/common';
import { TokenPayloadSchema } from '@providers/auth/strategys/jwtStrategy';
import { DateProvider } from '@providers/date/contracts/DateProvider';
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
  ) {}

  async execute({
    workspaceId,
    sub,
  }: Request): Promise<Either<Error, AvailableToSpendResponse>> {
    const timezone = await this.workspaceTimezone.execute(workspaceId);
    const now = this.dateProvider.now();
    const today = this.dateProvider.format(now, 'YYYY-MM-DD', timezone);
    const [year, month] = today.split('-').map(Number);

    const [budget, summary, goalAportesCents] = await Promise.all([
      this.getBudgetStatus.execute({ workspaceId, sub, month, year }),
      this.findMonthSummary.execute({ workspaceId, sub }),
      this.goalRepository.sumMonthlyAporteCents(workspaceId),
    ]);
    if (budget.isLeft()) return left(budget.value);
    if (summary.isLeft()) return left(summary.value);

    const { projection } = summary.value;
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
