import { BudgetSuggestionParametersInvalidError } from '@modules/budget/errors';
import {
  BudgetRepository,
  type BudgetSnapshot,
  type SuggestionParameters,
} from '@modules/budget/repositories/contracts/BudgetRepository';
import {
  inferIncome,
  type IncomeBase,
} from '@modules/budget/valueObjects/IncomeInference';
import {
  resolveIncomeBracket,
  type ResolvedBracket,
} from '@modules/budget/valueObjects/IncomeBracket';
import {
  buildSplitSuggestion,
  type SuggestedAllocation,
} from '@modules/budget/valueObjects/SplitSuggestion';
import { fingerprintOf } from '@modules/budget/valueObjects/SuggestionFingerprint';
import {
  resolveIncomeStatus,
  resolveSplitProgress,
  type IncomeStatus,
} from '@modules/budget/valueObjects/SuggestionDecisions';
import { MonthProjectionRepository } from '@modules/report/repositories/contracts/MonthProjectionRepository';
import { selectBasisMonths } from '@modules/report/valueObjects/MonthProjection';
import { LOOKBACK_MONTHS } from '@modules/report/valueObjects/ProjectionRules';
import { GetWorkspaceTimezoneService } from '@modules/workspace/services/get-workspace-timezone.service';
import { Injectable, Logger } from '@nestjs/common';
import { captureException } from '@sentry/nestjs';
import { TokenPayloadSchema } from '@providers/auth/strategys/jwtStrategy';
import { DateProvider } from '@providers/date/contracts/DateProvider';
import { Service } from '@shared/core/contracts/Service';
import { Either, right } from '@shared/core/errors/Either';

type Request = Pick<TokenPayloadSchema, 'workspaceId'>;

export const SPLIT_STEPS = 6;
const STALE_MINIMUM_WAGE_MONTHS = 13;

export type IncomeSuggestion =
  | {
      status: 'pending';
      incomeCents: number;
      base: IncomeBase;
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

export type BudgetSuggestion = {
  month: string;
  monthStart: Date;
  basisMonths: number;
  income: IncomeSuggestion;
  split: SplitSuggestionState;
};

type SuggestionDecisions = Awaited<
  ReturnType<BudgetRepository['findSuggestionDecisions']>
>;

type SplitSuggestionInput = {
  workspaceId: string;
  currentMonth: string;
  snapshot: BudgetSnapshot | null;
  basis: Record<string, number>[];
  parameters: SuggestionParameters;
  decisions: SuggestionDecisions;
};

const monthIndex = (key: string): number => {
  const [year, month] = key.split('-').map(Number);
  return year * 12 + month - 1;
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
  ) {}

  async execute({
    workspaceId,
  }: Request): Promise<Either<Error, BudgetSuggestion>> {
    const timezone = await this.workspaceTimezone.execute(workspaceId);
    const now = this.dateProvider.now();
    const key = this.dateProvider.format(now, 'YYYY-MM', timezone);
    const start = this.dateProvider.startOfMonth(`${key}-01`, timezone);

    const [ledger, totals, categories, parameters, decisions, snapshot] =
      await Promise.all([
        this.monthProjectionRepository.findMonthLedger({
          workspaceId,
          timezone,
          range: this.lookbackRange(start, timezone),
          currentMonthStart: start,
        }),
        this.budgetRepository.findInferenceTotals({
          workspaceId,
          timezone,
          ...this.lookbackRange(start, timezone),
        }),
        this.budgetRepository.findSuggestionCategories(workspaceId),
        this.budgetRepository.findSuggestionParameters(
          this.dateProvider.format(now, 'YYYY-MM-DD', timezone),
        ),
        this.budgetRepository.findSuggestionDecisions(workspaceId),
        this.budgetRepository.resolveSnapshot(workspaceId, start),
      ]);

    const basisKeys = selectBasisMonths(ledger, key).map(({ key }) => key);
    const totalsByMonth = new Map(totals.map((entry) => [entry.month, entry]));
    const incomes = basisKeys.map(
      (basisKey) => totalsByMonth.get(basisKey)?.incomeCents ?? 0,
    );
    const basis = basisKeys.map(
      (basisKey) => totalsByMonth.get(basisKey)?.expenseByCategory ?? {},
    );

    this.warnWhenMinimumWageIsStale(workspaceId, key, parameters);

    const income = this.incomeOf({
      incomes,
      decisions,
      snapshot,
      key,
    });
    const split = this.splitOf(
      {
        workspaceId,
        currentMonth: key,
        snapshot,
        basis,
        parameters,
        decisions,
      },
      categories,
    );

    return right({
      month: key,
      monthStart: start,
      basisMonths: basisKeys.length,
      income,
      split,
    });
  }

  private lookbackRange(start: Date, timezone: string) {
    const lookbackStart = this.dateProvider.startOfMonth(
      this.dateProvider.add(start, -LOOKBACK_MONTHS, 'month', timezone),
      timezone,
    );
    const previousMonth = this.dateProvider.add(start, -1, 'month', timezone);

    return {
      start: lookbackStart,
      end: this.dateProvider.endOfMonth(previousMonth, timezone),
    };
  }

  private incomeOf({
    incomes,
    decisions,
    snapshot,
    key,
  }: {
    incomes: number[];
    decisions: SuggestionDecisions;
    snapshot: BudgetSnapshot | null;
    key: string;
  }): IncomeSuggestion {
    const inferred = inferIncome(incomes);
    const status = resolveIncomeStatus({
      decisions,
      currentMonth: key,
      snapshotIncomeCents: snapshot?.monthlyIncome ?? null,
      inferredBaseCents: inferred?.incomeCents ?? null,
    });
    if (status !== 'pending' || !inferred) {
      return { status: status === 'pending' ? 'unavailable' : status };
    }

    const { incomeCents, base, incomeMonths, zeroIncomeMonths } = inferred;

    return {
      status: 'pending',
      incomeCents,
      base,
      incomeMonths,
      zeroIncomeMonths,
      fingerprint: fingerprintOf({
        kind: 'income',
        incomeCents,
        base,
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
  ): SplitSuggestionState {
    const { workspaceId, currentMonth, snapshot, basis, parameters } = input;
    const incomeBasisCents = snapshot?.monthlyIncome ?? null;
    const progress = resolveSplitProgress({
      decisions: input.decisions,
      currentMonth,
      hasIncomeBasis: incomeBasisCents !== null,
      steps: SPLIT_STEPS,
    });
    if (progress.status !== 'open') return { status: progress.status };
    if (basis.length === 0) return { status: 'unavailable' };

    const bracket = this.bracketOf(workspaceId, incomeBasisCents, parameters);
    const { allocations, unmappedCategoryIds } = buildSplitSuggestion({
      categories,
      spendByMonth: basis,
      groupByCategoryName: parameters.groupByCategoryName,
      incomeBasisCents,
      bracket,
      currentTargets: Object.fromEntries(
        (snapshot?.allocations ?? []).map(({ categoryId, targetCents }) => [
          categoryId,
          targetCents,
        ]),
      ),
      step: progress.step,
      steps: SPLIT_STEPS,
    });
    if (allocations.length === 0) return { status: 'unavailable' };

    const bracketVersion = bracket ? parameters.bracketVersion : null;

    return {
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
