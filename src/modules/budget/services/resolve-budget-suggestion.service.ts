import { BudgetSuggestionParametersInvalidError } from '@modules/budget/errors';
import {
  BudgetRepository,
  type BudgetSnapshot,
  type SuggestionParameters,
} from '@modules/budget/repositories/contracts/BudgetRepository';
import {
  lookbackRange,
  resolveIncomeBasis,
} from '@modules/budget/valueObjects/IncomeBasis';
import { type IncomeInference } from '@modules/budget/valueObjects/IncomeInference';
import {
  resolveIncomeBracket,
  type ResolvedBracket,
} from '@modules/budget/valueObjects/IncomeBracket';
import {
  buildSplitSuggestion,
  type SuggestedAllocation,
} from '@modules/budget/valueObjects/SplitSuggestion';
import { planTotalOf } from '@modules/budget/valueObjects/SplitAllocationLayout';
import { fingerprintOf } from '@modules/budget/valueObjects/SuggestionFingerprint';
import {
  resolveIncomeStatus,
  resolveSplitProgress,
  type IncomeStatus,
} from '@modules/budget/valueObjects/SuggestionDecisions';
import { CacheProvider } from '@infra/cache/contracts/CacheProvider';
import { readCategoryGeneration } from '@modules/category/services/category-list-cache';
import { MonthProjectionRepository } from '@modules/report/repositories/contracts/MonthProjectionRepository';
import { isPlanEligible } from '@modules/report/valueObjects/MonthProjection';
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
import { SingleFlight } from '@shared/cache/single-flight';
import { Service } from '@shared/core/contracts/Service';
import { Either, right } from '@shared/core/errors/Either';

type Request = Pick<TokenPayloadSchema, 'workspaceId'>;

export const SPLIT_STEPS = 6;
const STALE_MINIMUM_WAGE_MONTHS = 13;

export type IncomeSuggestion =
  | {
      status: 'pending';
      incomeCents: number;
      incomeMonths: number;
      zeroIncomeMonths: number;
      fingerprint: string;
    }
  | { status: Exclude<IncomeStatus, 'pending'> };

export type SplitSuggestionState =
  | {
      status: 'pending';
      step: number;
      steps: number;
      incomeBasisCents: number | null;
      bracket: { position: number; version: number } | null;
      allocations: SuggestedAllocation[];
      unmappedCategoryIds: string[];
      fingerprint: string;
    }
  | { status: 'accepted' | 'rejected' | 'complete' | 'unavailable' };

export type SuggestedPlan = {
  allocations: SuggestedAllocation[];
  planTotalCents: number;
  basisMonths: number;
};

export type BudgetSuggestion = {
  month: string;
  monthStart: Date;
  basisMonths: number;
  income: IncomeSuggestion;
  split: SplitSuggestionState;
  plan: SuggestedPlan | null;
  planEligible: boolean;
};

type SplitResolution = {
  split: SplitSuggestionState;
  plan: SuggestedPlan | null;
};

type SuggestionDecisions = Awaited<
  ReturnType<BudgetRepository['findSuggestionDecisions']>
>;

type SplitSuggestionInput = {
  workspaceId: string;
  currentMonth: string;
  snapshot: BudgetSnapshot | null;
  targets: Record<string, number>;
  basis: Record<string, number>[];
  parameters: SuggestionParameters;
  decisions: SuggestionDecisions;
};

type PlanBaseline = 'stored' | 'blank';

const unavailableOf = ({
  status,
}: ReturnType<typeof resolveSplitProgress>): SplitSuggestionState => ({
  status: status === 'open' ? 'unavailable' : status,
});

const monthIndex = (key: string): number => {
  const [year, month] = key.split('-').map(Number);
  return year * 12 + month - 1;
};

const targetsFor = (
  snapshot: BudgetSnapshot | null,
  baseline: PlanBaseline,
): Record<string, number> => {
  if (baseline === 'blank') return {};

  return Object.fromEntries(
    (snapshot?.allocations ?? []).map(({ categoryId, targetCents }) => [
      categoryId,
      targetCents,
    ]),
  );
};

@Injectable()
export class ResolveBudgetSuggestionService implements Service<
  Request,
  Error,
  BudgetSuggestion
> {
  private readonly logger = new Logger(ResolveBudgetSuggestionService.name);

  constructor(
    private readonly budgetRepository: BudgetRepository,
    private readonly monthProjectionRepository: MonthProjectionRepository,
    private readonly workspaceTimezone: GetWorkspaceTimezoneService,
    private readonly dateProvider: DateProvider,
    private readonly cache: CacheProvider,
    private readonly singleFlight: SingleFlight,
  ) {}

  async execute({
    workspaceId,
  }: Request): Promise<Either<Error, BudgetSuggestion>> {
    const [ledger, category] = await Promise.all([
      readLedgerGeneration(this.cache, workspaceId),
      readCategoryGeneration(this.cache, workspaceId),
    ]);
    const timezone = await this.workspaceTimezone.execute(workspaceId);
    const now = this.dateProvider.now();
    const key = buildCacheKey({
      route: 'budget:suggestion',
      version: 'v4',
      workspaceId,
      generations: { ledger, category },
      parts: [this.dateProvider.format(now, 'YYYY-MM-DD', timezone)],
    });

    return this.singleFlight.run(key, () =>
      readThrough({
        cache: this.cache,
        key,
        ttlSeconds: LEDGER_LIVE_CACHE_TTL_SECONDS,
        load: () => this.resolve(workspaceId, timezone, now, 'stored'),
      }),
    );
  }

  async resolveFresh({
    workspaceId,
  }: Request): Promise<Either<Error, BudgetSuggestion>> {
    const timezone = await this.workspaceTimezone.execute(workspaceId);

    return this.resolve(
      workspaceId,
      timezone,
      this.dateProvider.now(),
      'stored',
    );
  }

  async resolveFromBlankBaseline({
    workspaceId,
  }: Request): Promise<Either<Error, BudgetSuggestion>> {
    const timezone = await this.workspaceTimezone.execute(workspaceId);

    return this.resolve(
      workspaceId,
      timezone,
      this.dateProvider.now(),
      'blank',
    );
  }

  private async resolve(
    workspaceId: string,
    timezone: string,
    now: Date,
    baseline: PlanBaseline,
  ): Promise<Either<Error, BudgetSuggestion>> {
    const key = this.dateProvider.format(now, 'YYYY-MM', timezone);
    const start = this.dateProvider.startOfMonth(`${key}-01`, timezone);
    const range = lookbackRange(this.dateProvider, start, timezone);

    const [ledger, totals, categories, parameters, decisions, snapshot] =
      await Promise.all([
        this.monthProjectionRepository.findMonthLedger({
          workspaceId,
          timezone,
          range,
          currentMonthStart: start,
        }),
        this.budgetRepository.findInferenceTotals({
          workspaceId,
          timezone,
          ...range,
        }),
        this.budgetRepository.findSuggestionCategories(workspaceId),
        this.budgetRepository.findSuggestionParameters(
          this.dateProvider.format(now, 'YYYY-MM-DD', timezone),
        ),
        this.budgetRepository.findSuggestionDecisions(workspaceId),
        this.budgetRepository.resolveSnapshot(workspaceId, start),
      ]);

    const incomeBasis = resolveIncomeBasis(ledger, totals, key);
    const basis = incomeBasis.months.map((month) => month.expenseByCategory);

    this.warnWhenMinimumWageIsStale(workspaceId, key, parameters);

    const income = this.incomeOf({
      inference: incomeBasis.inference,
      decisions,
      snapshot,
      key,
    });
    const { split, plan } = this.splitOf(
      {
        workspaceId,
        currentMonth: key,
        snapshot,
        targets: targetsFor(snapshot, baseline),
        basis,
        parameters,
        decisions,
      },
      categories,
    );

    return right({
      month: key,
      monthStart: start,
      basisMonths: incomeBasis.months.length,
      income,
      split,
      plan,
      planEligible: isPlanEligible(ledger, key),
    });
  }

  private incomeOf({
    inference,
    decisions,
    snapshot,
    key,
  }: {
    inference: IncomeInference | null;
    decisions: SuggestionDecisions;
    snapshot: BudgetSnapshot | null;
    key: string;
  }): IncomeSuggestion {
    const status = resolveIncomeStatus({
      decisions,
      currentMonth: key,
      snapshotIncomeCents: snapshot?.monthlyIncome ?? null,
      inferredBaseCents: inference?.incomeCents ?? null,
    });
    if (status !== 'pending' || !inference) {
      return { status: status === 'pending' ? 'unavailable' : status };
    }

    const { incomeCents, incomeMonths, zeroIncomeMonths } = inference;

    return {
      status: 'pending',
      incomeCents,
      incomeMonths,
      zeroIncomeMonths,
      fingerprint: fingerprintOf({
        kind: 'income',
        incomeCents,
        incomeMonths,
        zeroIncomeMonths,
      }),
    };
  }

  private splitOf(
    input: SplitSuggestionInput,
    categories: Awaited<
      ReturnType<BudgetRepository['findSuggestionCategories']>
    >,
  ): SplitResolution {
    const { workspaceId, currentMonth, snapshot, basis, parameters } = input;
    const incomeBasisCents = snapshot?.monthlyIncome ?? null;
    const progress = resolveSplitProgress({
      decisions: input.decisions,
      currentMonth,
      hasIncomeBasis: incomeBasisCents !== null,
      steps: SPLIT_STEPS,
    });
    if (basis.length === 0)
      return { split: unavailableOf(progress), plan: null };

    const bracket = this.bracketOf(workspaceId, incomeBasisCents, parameters);
    const { allocations, unmappedCategoryIds } = buildSplitSuggestion({
      categories,
      spendByMonth: basis,
      groupByCategoryName: parameters.groupByCategoryName,
      incomeBasisCents,
      bracket,
      currentTargets: input.targets,
      step: progress.step,
      steps: SPLIT_STEPS,
    });
    if (allocations.length === 0) {
      return { split: unavailableOf(progress), plan: null };
    }

    const plan: SuggestedPlan = {
      allocations,
      planTotalCents: planTotalOf(allocations),
      basisMonths: basis.length,
    };
    if (progress.status !== 'open') {
      return { split: { status: progress.status }, plan };
    }

    const bracketVersion = bracket ? parameters.bracketVersion : null;

    return {
      plan,
      split: {
        status: 'pending',
        step: progress.step,
        steps: SPLIT_STEPS,
        incomeBasisCents,
        bracket:
          bracket && bracketVersion !== null
            ? { position: bracket.position, version: bracketVersion }
            : null,
        allocations,
        unmappedCategoryIds,
        fingerprint: fingerprintOf({
          kind: 'split',
          step: progress.step,
          incomeBasisCents,
          bracketVersion,
          allocations,
        }),
      },
    };
  }

  private bracketOf(
    workspaceId: string,
    incomeBasisCents: number | null,
    parameters: SuggestionParameters,
  ): ResolvedBracket | null {
    if (incomeBasisCents === null) return null;

    const bracket = parameters.minimumWage
      ? resolveIncomeBracket({
          incomeCents: incomeBasisCents,
          minimumWageCents: parameters.minimumWage.valueCents,
          rows: parameters.bracketRows,
        })
      : null;
    if (bracket) return bracket;

    this.logger.error(
      `budget-suggestion.parameters-invalid workspaceId=${workspaceId}`,
    );
    captureException(new BudgetSuggestionParametersInvalidError(), {
      extra: { workspaceId },
    });
    return null;
  }

  private warnWhenMinimumWageIsStale(
    workspaceId: string,
    currentKey: string,
    { minimumWage }: SuggestionParameters,
  ): void {
    if (!minimumWage) return;

    const age =
      monthIndex(currentKey) -
      monthIndex(minimumWage.effectiveFrom.slice(0, 7));
    if (age <= STALE_MINIMUM_WAGE_MONTHS) return;

    this.logger.warn(
      `budget-suggestion.minimum-wage-stale workspaceId=${workspaceId} effectiveFrom=${minimumWage.effectiveFrom}`,
    );
  }
}
