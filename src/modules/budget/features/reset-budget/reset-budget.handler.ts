import { CacheProvider } from '@infra/cache/contracts/CacheProvider';
import {
  BudgetResetUnavailableError,
  BudgetSuggestionChangedError,
} from '@modules/budget/errors';
import {
  BudgetRepository,
  type ResetSnapshotOutcome,
  type SuggestedAllocationInput,
} from '@modules/budget/repositories/contracts/BudgetRepository';
import {
  type BudgetSuggestion,
  ResolveBudgetSuggestionService,
} from '@modules/budget/services/resolve-budget-suggestion.service';
import {
  buildBudgetConfigResponse,
  type BudgetConfigResponse,
} from '@modules/budget/valueObjects/BudgetConfigResponse';
import { toAllocationInputs } from '@modules/budget/valueObjects/SplitAllocationLayout';
import { fingerprintOf } from '@modules/budget/valueObjects/SuggestionFingerprint';
import { Injectable } from '@nestjs/common';
import { captureException } from '@sentry/nestjs';
import { type TokenPayloadSchema } from '@providers/auth/strategys/jwtStrategy';
import { invalidateLedgerReads } from '@shared/cache/report-cache';
import { Service } from '@shared/core/contracts/Service';
import { Either, left, right } from '@shared/core/errors/Either';
import { ServiceUnavailableDomainError } from '@shared/core/errors/DomainError';

type Request = Pick<TokenPayloadSchema, 'workspaceId'>;

type ResetTarget = {
  month: string;
  monthStart: Date;
  monthlyIncome: number;
  fingerprint: string;
};

type ResetWrite = {
  workspaceId: string;
  month: string;
  monthStart: Date;
  monthlyIncome: number;
  fingerprint: string;
  allocations: SuggestedAllocationInput[];
};

const isPresent = (value: number | null | undefined): value is number =>
  value !== null && value !== undefined;

@Injectable()
export class ResetBudgetService implements Service<
  Request,
  Error,
  BudgetConfigResponse
> {
  constructor(
    private readonly resolveSuggestion: ResolveBudgetSuggestionService,
    private readonly budgetRepository: BudgetRepository,
    private readonly cache: CacheProvider,
  ) {}

  async execute({
    workspaceId,
  }: Request): Promise<Either<Error, BudgetConfigResponse>> {
    const resolved = await this.resolveSuggestion.resolveFromBlankBaseline({
      workspaceId,
    });
    if (resolved.isLeft()) return this.reject(workspaceId, resolved.value);

    const suggestion = resolved.value;
    if (!suggestion.plan) {
      return this.reject(workspaceId, new BudgetResetUnavailableError());
    }

    const target = await this.targetOf(workspaceId, suggestion);
    if (target.isLeft()) return this.reject(workspaceId, target.value);

    const allocations = toAllocationInputs(suggestion.plan.allocations);
    if (allocations.length === 0) {
      return this.reject(workspaceId, new BudgetResetUnavailableError());
    }

    const { month, monthStart, monthlyIncome, fingerprint } = target.value;
    const outcome = await this.write({
      workspaceId,
      month,
      monthStart,
      monthlyIncome,
      fingerprint,
      allocations,
    });
    if (outcome.isLeft()) return this.reject(workspaceId, outcome.value);

    if (outcome.value.status === 'drifted') {
      return this.reject(workspaceId, new BudgetSuggestionChangedError());
    }

    await invalidateLedgerReads(this.cache, workspaceId, 'reset-budget');

    return right(
      buildBudgetConfigResponse({
        saved: outcome.value.snapshot,
        mode: outcome.value.mode,
        monthlyIncomeCents: monthlyIncome,
        targetCents: allocations.map(({ targetCents }) => targetCents),
      }),
    );
  }

  private async write({
    workspaceId,
    month,
    monthStart,
    monthlyIncome,
    fingerprint,
    allocations,
  }: ResetWrite): Promise<Either<Error, ResetSnapshotOutcome>> {
    try {
      const outcome = await this.budgetRepository.resetSnapshot({
        workspaceId,
        effectiveFrom: monthStart,
        decision: {
          workspaceId,
          kind: 'reset',
          month,
          decision: 'accepted',
          incomeCents: monthlyIncome,
          bracketVersion: null,
        },
        allocations,
        isStillCurrent: () =>
          this.isStillCurrent(workspaceId, monthStart, fingerprint),
      });

      return right(outcome);
    } catch (error) {
      if (error instanceof ServiceUnavailableDomainError) return left(error);

      throw error;
    }
  }

  private async targetOf(
    workspaceId: string,
    suggestion: BudgetSuggestion,
  ): Promise<Either<Error, ResetTarget>> {
    const snapshot = await this.budgetRepository.resolveSnapshot(
      workspaceId,
      suggestion.monthStart,
    );
    if (!isPresent(snapshot?.monthlyIncome)) {
      return left(new BudgetResetUnavailableError());
    }

    return right({
      month: suggestion.month,
      monthStart: suggestion.monthStart,
      monthlyIncome: snapshot.monthlyIncome,
      fingerprint: this.fingerprintOf(suggestion, snapshot.monthlyIncome),
    });
  }

  private async isStillCurrent(
    workspaceId: string,
    monthStart: Date,
    fingerprint: string,
  ): Promise<boolean> {
    const resolved = await this.resolveSuggestion.resolveFromBlankBaseline({
      workspaceId,
    });
    if (resolved.isLeft() || !resolved.value.plan) return false;

    const snapshot = await this.budgetRepository.resolveSnapshot(
      workspaceId,
      monthStart,
    );
    if (!isPresent(snapshot?.monthlyIncome)) return false;

    return (
      this.fingerprintOf(resolved.value, snapshot.monthlyIncome) === fingerprint
    );
  }

  private fingerprintOf(
    { month, basisMonths, plan }: BudgetSuggestion,
    monthlyIncome: number,
  ): string {
    return fingerprintOf({
      kind: 'reset',
      month,
      monthlyIncome,
      basisMonths,
      allocations: (plan?.allocations ?? []).map(
        ({ categoryId, group, actualCents, idealCents, suggestedCents }) => ({
          categoryId,
          group,
          actualCents,
          idealCents,
          suggestedCents,
        }),
      ),
    });
  }

  private reject(
    workspaceId: string,
    error: Error,
  ): Either<Error, BudgetConfigResponse> {
    captureException(error, { extra: { workspaceId } });

    return left(error);
  }
}
