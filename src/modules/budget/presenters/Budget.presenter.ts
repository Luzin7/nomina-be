import { toHTTPProjection } from '@modules/report/presenters/MonthProjection.presenter';
import { BudgetStatusResponse } from '../features/get-status/get-status.handler';
import { BudgetSetupResponse } from '../features/get-setup/get-setup.handler';
import { SaveBudgetConfigResponse } from '../features/save-config/save-config.handler';

export class BudgetPresenter {
  static toStatus(response: BudgetStatusResponse) {
    if (!response.exists) return { exists: false as const };

    return {
      exists: true as const,
      mode: response.mode,
      monthlyIncomeCents: response.monthlyIncomeCents,
      effectiveFrom: response.effectiveFrom,
      allocations: response.allocations.map((allocation) => ({
        categoryId: allocation.categoryId,
        categoryName: allocation.categoryName,
        groupName: allocation.groupName,
        targetCents: allocation.targetCents,
        spentCents: allocation.spentCents,
        remainingCents: allocation.remainingCents,
        percentageOfIncome: allocation.percentageOfIncome,
        percentageUsed: allocation.percentageUsed,
      })),
      pillars: response.pillars.map((pillar) => ({
        groupName: pillar.groupName,
        targetCents: pillar.targetCents,
        spentCents: pillar.spentCents,
        percentage: pillar.percentage,
      })),
      unallocatedSpent: response.unallocatedSpent,
      totalTargetCents: response.totalTargetCents,
      unallocatedIncomeCents: response.unallocatedIncomeCents,
      allocationState: response.allocationState,
      totalSpent: response.totalSpent,
      projection:
        response.projection === null
          ? null
          : toHTTPProjection(response.projection),
    };
  }

  static toConfig(response: SaveBudgetConfigResponse) {
    return {
      id: response.id,
      effectiveFrom: response.effectiveFrom,
      mode: response.mode,
      monthlyIncomeCents: response.monthlyIncomeCents,
      totalTargetCents: response.totalTargetCents,
      unallocatedIncomeCents: response.unallocatedIncomeCents,
      allocationState: response.allocationState,
    };
  }

  static toSetup(response: BudgetSetupResponse) {
    return {
      mode: response.mode,
      suggestedIncome: response.suggestedIncome,
      allocations: response.allocations.map((allocation) => ({
        categoryId: allocation.categoryId,
        categoryName: allocation.categoryName,
        percentageOfIncome: allocation.percentageOfIncome,
        groupName: allocation.groupName,
      })),
    };
  }
}
