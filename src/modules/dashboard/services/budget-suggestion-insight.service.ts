import { ResolveBudgetSuggestionService } from '@modules/budget/services/resolve-budget-suggestion.service';
import { Injectable, Logger } from '@nestjs/common';
import type { AvailableToSpendInsight } from '../valueObjects/AvailableToSpend';
import { describeError } from '@modules/dashboard/services/describe-error';

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
      return await this.pendingOf(workspaceId);
    } catch (error) {
      this.logger.warn(
        `budget-suggestion insight skipped workspaceId=${workspaceId} error=${describeError(error)}`,
      );
      return null;
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
