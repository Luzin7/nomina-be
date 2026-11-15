import { CacheProvider } from '@infra/cache/contracts/CacheProvider';
import { BudgetSuggestionUnavailableError } from '@modules/budget/errors';
import { BudgetRepository } from '@modules/budget/repositories/contracts/BudgetRepository';
import {
  ResolveBudgetSuggestionService,
  type BudgetSuggestion,
} from '@modules/budget/services/resolve-budget-suggestion.service';
import {
  type SuggestionDecisionOutcome,
  type SuggestionKind,
} from '@modules/budget/valueObjects/SuggestionDecisions';
import { Injectable } from '@nestjs/common';
import { TokenPayloadSchema } from '@providers/auth/strategys/jwtStrategy';
import { invalidateLedgerReads } from '@shared/cache/report-cache';
import { Service } from '@shared/core/contracts/Service';
import { Either, left, right } from '@shared/core/errors/Either';
import { RejectBudgetSuggestionRequest } from './reject-budget-suggestion.dto';

type Request = RejectBudgetSuggestionRequest &
  Pick<TokenPayloadSchema, 'workspaceId'>;

type Rejection = { incomeCents: number | null; bracketVersion: number | null };

const rejectionOf = (
  kind: SuggestionKind,
  { income, split }: BudgetSuggestion,
): Rejection | null => {
  if (kind === 'income') {
    return income.status === 'pending'
      ? { incomeCents: income.incomeCents, bracketVersion: null }
      : null;
  }

  return split.status === 'pending'
    ? {
        incomeCents: split.incomeBasisCents,
        bracketVersion: split.bracket?.version ?? null,
      }
    : null;
};

const statusOf = (
  kind: SuggestionKind,
  { income, split }: BudgetSuggestion,
): string => (kind === 'income' ? income.status : split.status);

const rejectedOf = (
  kind: SuggestionKind,
  month: string,
): SuggestionDecisionOutcome => ({ kind, status: 'rejected', month });

@Injectable()
export class RejectBudgetSuggestionService implements Service<
  Request,
  Error,
  SuggestionDecisionOutcome
> {
  constructor(
    private readonly resolveSuggestion: ResolveBudgetSuggestionService,
    private readonly budgetRepository: BudgetRepository,
    private readonly cache: CacheProvider,
  ) {}

  async execute({
    workspaceId,
    kind,
  }: Request): Promise<Either<Error, SuggestionDecisionOutcome>> {
    const resolved = await this.resolveSuggestion.execute({ workspaceId });
    if (resolved.isLeft()) return left(resolved.value);

    const { month } = resolved.value;
    if (statusOf(kind, resolved.value) === 'rejected') {
      return right(rejectedOf(kind, month));
    }

    const rejection = rejectionOf(kind, resolved.value);
    if (!rejection) return left(new BudgetSuggestionUnavailableError());

    const outcome = await this.budgetRepository.saveDecision({
      workspaceId,
      kind,
      month,
      decision: 'rejected',
      ...rejection,
    });
    if (outcome === 'already-decided') {
      return this.settleConcurrentDecision(workspaceId, kind);
    }

    await invalidateLedgerReads(
      this.cache,
      workspaceId,
      'reject-budget-suggestion',
    );

    return right(rejectedOf(kind, month));
  }

  private async settleConcurrentDecision(
    workspaceId: string,
    kind: SuggestionKind,
  ): Promise<Either<Error, SuggestionDecisionOutcome>> {
    const current = await this.resolveSuggestion.execute({ workspaceId });
    if (current.isLeft()) return left(current.value);

    if (statusOf(kind, current.value) !== 'rejected') {
      return left(new BudgetSuggestionUnavailableError());
    }

    return right(rejectedOf(kind, current.value.month));
  }
}
