import { CacheProvider } from '@infra/cache/contracts/CacheProvider';
import {
  BudgetSuggestionChangedError,
  BudgetSuggestionUnavailableError,
} from '@modules/budget/errors';
import { BudgetRepository } from '@modules/budget/repositories/contracts/BudgetRepository';
import {
  ResolveBudgetSuggestionService,
  type BudgetSuggestion,
} from '@modules/budget/services/resolve-budget-suggestion.service';
import { type SuggestionDecisionOutcome } from '@modules/budget/valueObjects/SuggestionDecisions';
import { Injectable } from '@nestjs/common';
import { TokenPayloadSchema } from '@providers/auth/strategys/jwtStrategy';
import { invalidateLedgerReads } from '@shared/cache/report-cache';
import { Service } from '@shared/core/contracts/Service';
import { Either, left, right } from '@shared/core/errors/Either';
import { AcceptIncomeSuggestionRequest } from './accept-income-suggestion.dto';

type Request = AcceptIncomeSuggestionRequest &
  Pick<TokenPayloadSchema, 'workspaceId'>;

@Injectable()
export class AcceptIncomeSuggestionService implements Service<
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
    fingerprint,
  }: Request): Promise<Either<Error, SuggestionDecisionOutcome>> {
    const resolved = await this.resolveSuggestion.execute({ workspaceId });
    if (resolved.isLeft()) return left(resolved.value);

    const { income, month, monthStart } = resolved.value;
    if (income.status === 'accepted') return right(acceptedOf(month));
    if (income.status !== 'pending') {
      return left(new BudgetSuggestionUnavailableError());
    }
    if (income.fingerprint !== fingerprint) {
      return left(new BudgetSuggestionChangedError());
    }

    const outcome = await this.budgetRepository.saveSnapshotWithDecision({
      workspaceId,
      effectiveFrom: monthStart,
      expectedMonthlyIncome: null,
      decision: {
        workspaceId,
        kind: 'income',
        month,
        decision: 'accepted',
        incomeCents: income.incomeCents,
        bracketVersion: null,
      },
      write: { kind: 'income', monthlyIncome: income.incomeCents },
      isStillCurrent: () => this.isStillCurrent(workspaceId, fingerprint),
    });
    if (outcome === 'drifted') return left(new BudgetSuggestionChangedError());
    if (outcome === 'already-decided') return this.settled(workspaceId);

    await invalidateLedgerReads(
      this.cache,
      workspaceId,
      'accept-income-suggestion',
    );

    return right(acceptedOf(month));
  }

  private async isStillCurrent(
    workspaceId: string,
    fingerprint: string,
  ): Promise<boolean> {
    const resolved = await this.resolveSuggestion.execute({ workspaceId });
    if (resolved.isLeft()) return false;

    const { income } = resolved.value;

    return income.status === 'pending' && income.fingerprint === fingerprint;
  }

  private async settled(
    workspaceId: string,
  ): Promise<Either<Error, SuggestionDecisionOutcome>> {
    const resolved = await this.resolveSuggestion.execute({ workspaceId });
    if (resolved.isLeft()) return left(resolved.value);

    return isAccepted(resolved.value)
      ? right(acceptedOf(resolved.value.month))
      : left(new BudgetSuggestionUnavailableError());
  }
}

const isAccepted = ({ income }: BudgetSuggestion): boolean =>
  income.status === 'accepted';

const acceptedOf = (month: string): SuggestionDecisionOutcome => ({
  kind: 'income',
  status: 'accepted',
  month,
});
