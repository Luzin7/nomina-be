import { BUDGET_MODE_DEFAULT, type BudgetMode } from '@constants/enums';
import { CacheProvider } from '@infra/cache/contracts/CacheProvider';
import {
  BudgetRepository,
  SaveBudgetAllocationInput,
} from '@modules/budget/repositories/contracts/BudgetRepository';
import {
  BudgetSnapshotConflictError,
  ForbiddenBudgetCategoryError,
  HistoricalBudgetImmutableError,
  InvalidBudgetEffectiveDateError,
} from '@modules/budget/errors';
import {
  type BudgetAllocationFields,
  ValidateBudgetAllocationsService,
} from '@modules/budget/services/validate-budget-allocations.service';
import {
  buildBudgetConfigResponse,
  type BudgetConfigResponse,
} from '@modules/budget/valueObjects/BudgetConfigResponse';
import { distributeTargets } from '@modules/budget/valueObjects/LargestRemainder';
import { GetWorkspaceTimezoneService } from '@modules/workspace/services/get-workspace-timezone.service';
import { Injectable } from '@nestjs/common';
import { TokenPayloadSchema } from '@providers/auth/strategys/jwtStrategy';
import { DateProvider } from '@providers/date/contracts/DateProvider';
import { invalidateMonthReads } from '@shared/cache/report-cache';
import { Service } from '@shared/core/contracts/Service';
import { Either, left, right } from '@shared/core/errors/Either';
import { SaveBudgetConfigRequest } from './save-config.dto';

type Request = SaveBudgetConfigRequest &
  Pick<TokenPayloadSchema, 'workspaceId'>;

type AllocationInput = SaveBudgetConfigRequest['allocations'][number];

type EffectiveFromInput = {
  request: Request;
  timezone: string;
  today: Date;
};

type BuildAllocationsInput = {
  mode: BudgetMode;
  monthlyIncome: number;
  allocations: AllocationInput[];
  fields: BudgetAllocationFields;
};

export type SaveBudgetConfigResponse = BudgetConfigResponse;

const DEFAULT_GROUP_NAME = 'Geral';

@Injectable()
export class SaveBudgetConfigService implements Service<
  Request,
  Error,
  SaveBudgetConfigResponse
> {
  constructor(
    private readonly budgetRepository: BudgetRepository,
    private readonly validateAllocations: ValidateBudgetAllocationsService,
    private readonly workspaceTimezone: GetWorkspaceTimezoneService,
    private readonly dateProvider: DateProvider,
    private readonly cache: CacheProvider,
  ) {}

  async execute(
    request: Request,
  ): Promise<Either<Error, SaveBudgetConfigResponse>> {
    const { workspaceId, monthlyIncome, allocations } = request;
    const { mode } = request;

    const fields = this.validateAllocations.parseFields(mode, allocations);
    if (fields.isLeft()) return left(fields.value);

    const timezone = await this.workspaceTimezone.execute(workspaceId);
    const effectiveFrom = this.resolveEffectiveFrom({
      request,
      timezone,
      today: this.dateProvider.now(),
    });
    if (effectiveFrom.isLeft()) return left(effectiveFrom.value);

    const categoryError = await this.validateAllocations.validateCategories({
      workspaceId,
      effectiveFrom: effectiveFrom.value,
      allocations,
      requireRootCategories: false,
    });
    if (categoryError) return left(categoryError);

    const savedAllocations = this.buildAllocations({
      mode,
      monthlyIncome,
      allocations,
      fields: fields.value,
    });

    try {
      const saved = await this.budgetRepository.saveSnapshot({
        workspaceId,
        effectiveFrom: effectiveFrom.value,
        monthlyIncome,
        mode,
        allocations: savedAllocations,
      });
      const effectiveMonth = this.dateProvider.format(
        effectiveFrom.value,
        'YYYY-MM',
        timezone,
      );
      await invalidateMonthReads(
        this.cache,
        workspaceId,
        [effectiveMonth],
        'save-budget-config',
      );

      return right(
        buildBudgetConfigResponse({
          saved,
          mode,
          monthlyIncomeCents: monthlyIncome,
          targetCents: savedAllocations.map(({ targetCents }) => targetCents),
        }),
      );
    } catch (error) {
      if (
        error instanceof BudgetSnapshotConflictError ||
        error instanceof ForbiddenBudgetCategoryError
      ) {
        return left(error);
      }

      throw error;
    }
  }

  private resolveEffectiveFrom({
    request,
    timezone,
    today,
  }: EffectiveFromInput): Either<Error, Date> {
    const currentMonthStart = this.dateProvider.startOfMonth(today, timezone);
    const nextMonthStart = this.dateProvider.startOfMonth(
      this.dateProvider.add(currentMonthStart, 1, 'month', timezone),
      timezone,
    );
    const effectiveFrom = request.effectiveFrom
      ? this.dateProvider.startOfMonth(request.effectiveFrom, timezone)
      : nextMonthStart;

    if (effectiveFrom.getTime() < currentMonthStart.getTime()) {
      return left(new HistoricalBudgetImmutableError());
    }

    if (
      effectiveFrom.getTime() !== currentMonthStart.getTime() &&
      effectiveFrom.getTime() !== nextMonthStart.getTime()
    ) {
      return left(new InvalidBudgetEffectiveDateError());
    }

    return right(effectiveFrom);
  }

  private buildAllocations({
    mode,
    monthlyIncome,
    allocations,
    fields,
  }: BuildAllocationsInput): SaveBudgetAllocationInput[] {
    const targets =
      mode === BUDGET_MODE_DEFAULT
        ? distributeTargets(monthlyIncome, fields.percentages)
        : fields.targets;

    return allocations.map((allocation, index) => ({
      categoryId: allocation.categoryId,
      groupName: allocation.groupName ?? DEFAULT_GROUP_NAME,
      groupOrder: allocation.groupOrder ?? 0,
      categoryOrder: allocation.categoryOrder ?? index,
      percentageOfIncome:
        mode === BUDGET_MODE_DEFAULT
          ? fields.percentages[index]
          : Math.round((targets[index] / monthlyIncome) * 100),
      targetCents: targets[index],
    }));
  }
}
