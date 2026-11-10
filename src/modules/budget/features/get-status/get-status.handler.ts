import { type BudgetMode } from '@constants/enums';
import { BudgetRepository } from '@modules/budget/repositories/contracts/BudgetRepository';
import {
  resolveAllocationState,
  type BudgetAllocationState,
} from '@modules/budget/valueObjects/BudgetAllocationState';
import { attributeSpendToAllocations } from '@modules/budget/valueObjects/BudgetSpendAttribution';
import { FindMonthSummaryService } from '@modules/report/features/get-month-summary/get-month-summary.service';
import type { MonthProjection } from '@modules/report/valueObjects/MonthProjection';
import { GetWorkspaceTimezoneService } from '@modules/workspace/services/get-workspace-timezone.service';
import { Injectable } from '@nestjs/common';
import { TokenPayloadSchema } from '@providers/auth/strategys/jwtStrategy';
import { DateProvider } from '@providers/date/contracts/DateProvider';
import { Service } from '@shared/core/contracts/Service';
import { Either, left, right } from '@shared/core/errors/Either';
import { GetBudgetStatusRequest } from './get-status.dto';

type Request = GetBudgetStatusRequest &
  Pick<TokenPayloadSchema, 'workspaceId' | 'sub'>;

export type BudgetStatusAllocation = {
  categoryId: string;
  categoryName: string;
  groupName: string;
  targetCents: number;
  spentCents: number;
  remainingCents: number;
  percentageOfIncome: number;
  percentageUsed: number;
};

export type BudgetStatusPillar = {
  groupName: string;
  targetCents: number;
  spentCents: number;
  percentage: number;
};

export type BudgetStatusResponse =
  | { exists: false }
  | {
      exists: true;
      mode: BudgetMode;
      monthlyIncomeCents: number;
      effectiveFrom: Date;
      allocations: BudgetStatusAllocation[];
      pillars: BudgetStatusPillar[];
      unallocatedSpent: number;
      totalTargetCents: number;
      unallocatedIncomeCents: number;
      allocationState: BudgetAllocationState;
      totalSpent: number;
      projection: MonthProjection | null;
    };

@Injectable()
export class GetBudgetStatusService implements Service<
  Request,
  Error,
  BudgetStatusResponse
> {
  constructor(
    private readonly budgetRepository: BudgetRepository,
    private readonly findMonthSummary: FindMonthSummaryService,
    private readonly workspaceTimezone: GetWorkspaceTimezoneService,
    private readonly dateProvider: DateProvider,
  ) {}

  async execute(
    request: Request,
  ): Promise<Either<Error, BudgetStatusResponse>> {
    const { workspaceId, month, year } = request;
    const timezone = await this.workspaceTimezone.execute(workspaceId);
    const referenceDate = `${year}-${String(month).padStart(2, '0')}-01`;
    const monthStart = this.dateProvider.startOfMonth(referenceDate, timezone);
    const monthEnd = this.dateProvider.endOfMonth(referenceDate, timezone);
    const currentMonthStart = this.dateProvider.startOfMonth(
      this.dateProvider.now(),
      timezone,
    );
    const isCurrentMonth = monthStart.getTime() === currentMonthStart.getTime();

    const snapshot = await this.budgetRepository.resolveSnapshot(
      workspaceId,
      monthStart,
    );
    if (!snapshot) return right({ exists: false });

    const [expensesByCategory, categoryParentMap, summary] = await Promise.all([
      this.budgetRepository.findCompletedExpenseByCategory(
        workspaceId,
        monthStart,
        monthEnd,
      ),
      this.budgetRepository.findCategoryParentMap(workspaceId),
      isCurrentMonth
        ? this.findMonthSummary.execute({ workspaceId, sub: request.sub })
        : Promise.resolve(null),
    ]);

    if (summary?.isLeft()) return left(summary.value);

    const visibleAllocations = snapshot.allocations.filter(
      (allocation) => allocation.categoryName !== null,
    );
    const totalTargetCents = snapshot.allocations.reduce(
      (total, allocation) => total + allocation.targetCents,
      0,
    );
    const { spentByAllocation, unallocatedSpent } = attributeSpendToAllocations(
      expensesByCategory,
      categoryParentMap,
      new Set(visibleAllocations.map((allocation) => allocation.categoryId)),
    );
    const pillars = new Map<string, BudgetStatusPillar>();
    const allocations = visibleAllocations.map((allocation) => {
      const spentCents = spentByAllocation[allocation.categoryId] ?? 0;
      const pillar = pillars.get(allocation.groupName) ?? {
        groupName: allocation.groupName,
        targetCents: 0,
        spentCents: 0,
        percentage: 0,
      };

      pillar.targetCents += allocation.targetCents;
      pillar.spentCents += spentCents;
      pillar.percentage += allocation.percentageOfIncome;
      pillars.set(allocation.groupName, pillar);

      return {
        categoryId: allocation.categoryId,
        categoryName: allocation.categoryName as string,
        groupName: allocation.groupName,
        targetCents: allocation.targetCents,
        spentCents,
        remainingCents: allocation.targetCents - spentCents,
        percentageOfIncome: allocation.percentageOfIncome,
        percentageUsed:
          allocation.targetCents === 0
            ? 0
            : Math.round((spentCents / allocation.targetCents) * 100),
      };
    });

    const totalSpent = Object.values(expensesByCategory).reduce(
      (total, value) => total + value,
      0,
    );

    return right({
      exists: true,
      mode: snapshot.mode,
      monthlyIncomeCents: snapshot.monthlyIncome,
      effectiveFrom: snapshot.effectiveFrom,
      allocations,
      pillars: [...pillars.values()],
      unallocatedSpent,
      totalTargetCents,
      unallocatedIncomeCents: Math.max(
        0,
        snapshot.monthlyIncome - totalTargetCents,
      ),
      allocationState: resolveAllocationState(
        snapshot.monthlyIncome,
        totalTargetCents,
      ),
      totalSpent,
      projection: summary?.isRight() ? summary.value.projection : null,
    });
  }
}
