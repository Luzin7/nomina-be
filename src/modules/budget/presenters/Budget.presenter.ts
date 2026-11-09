import { toHTTPProjection } from '@modules/report/presenters/MonthProjection.presenter';
import { BudgetStatusResponse } from '../features/get-status/get-status.handler';
import { BudgetSetupResponse } from '../features/get-setup/get-setup.handler';

export class BudgetPresenter {
  static toStatus(response: BudgetStatusResponse) {
    if (!response.exists) return { exists: false as const };

    return {
      exists: true as const,
      monthlyIncome: response.monthlyIncome,
      effectiveFrom: response.effectiveFrom,
      allocations: response.allocations.map((allocation) => ({
        categoryId: allocation.categoryId,
        categoryName: allocation.categoryName,
        groupName: allocation.groupName,
        targetCents: allocation.targetCents,
        spentCents: allocation.spentCents,
        remainingCents: allocation.remainingCents,
        percentageUsed: allocation.percentageUsed,
      })),
      pillars: response.pillars.map((pillar) => ({
        groupName: pillar.groupName,
        targetCents: pillar.targetCents,
        spentCents: pillar.spentCents,
        percentage: pillar.percentage,
      })),
      unallocatedSpent: response.unallocatedSpent,
      totalTarget: response.totalTarget,
      totalSpent: response.totalSpent,
      projection:
        response.projection === null
          ? null
          : toHTTPProjection(response.projection),
    };
  }

  static toConfig(response: { id: string; effectiveFrom: Date }) {
    return { id: response.id, effectiveFrom: response.effectiveFrom };
  }

  static toSetup(response: BudgetSetupResponse) {
    return {
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
