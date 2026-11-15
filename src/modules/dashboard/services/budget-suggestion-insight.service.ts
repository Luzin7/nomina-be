import { ResolveBudgetSuggestionService } from '@modules/budget/services/resolve-budget-suggestion.service';
import { Injectable, Logger } from '@nestjs/common';
import type { AvailableToSpendInsight } from '../valueObjects/AvailableToSpend';

export const BUDGET_SUGGESTION_INSIGHT_BUDGET_MS = 200;

type Request = { workspaceId: string };

@Injectable()
export class BudgetSuggestionInsightService {
  private readonly logger = new Logger(BudgetSuggestionInsightService.name);

  constructor(
    private readonly resolveSuggestion: ResolveBudgetSuggestionService,
  ) {}

  async execute({
    workspaceId,
  }: Request): Promise<AvailableToSpendInsight | null> {
    try {
      return await this.withinBudget(workspaceId);
    } catch (error) {
      this.logger.warn(
        `budget-suggestion insight skipped workspaceId=${workspaceId} error=${error instanceof Error ? error.constructor.name : typeof error}`,
      );
      return null;
    }
  }

  private async withinBudget(
    workspaceId: string,
  ): Promise<AvailableToSpendInsight | null> {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(
        () => reject(new Error('budget-suggestion insight timed out')),
        BUDGET_SUGGESTION_INSIGHT_BUDGET_MS,
      );
    });

    try {
      return await Promise.race([this.pendingOf(workspaceId), timeout]);
    } finally {
      clearTimeout(timer);
    }
  }

  private async pendingOf(
    workspaceId: string,
  ): Promise<AvailableToSpendInsight | null> {
    const result = await this.resolveSuggestion.execute({ workspaceId });
    if (result.isLeft()) throw result.value;

    const { income, split } = result.value;
    const kind =
      income.status === 'pending'
        ? 'income'
        : split.status === 'pending'
          ? 'split'
          : null;
    if (kind === null) return null;

    return {
      code: 'BUDGET_SUGGESTION_READY',
      severity: 'low',
      args: { kind },
      href: '/budget',
    };
  }
}
