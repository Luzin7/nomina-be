import { BudgetRepository } from '@modules/budget/repositories/contracts/BudgetRepository';
import { buildPresetAllocations } from '@modules/budget/valueObjects/BudgetPreset';
import { Injectable } from '@nestjs/common';
import { TokenPayloadSchema } from '@providers/auth/strategys/jwtStrategy';
import { Service } from '@shared/core/contracts/Service';
import { Either, right } from '@shared/core/errors/Either';
import { GetBudgetSetupRequest } from './get-setup.dto';

type Request = GetBudgetSetupRequest & Pick<TokenPayloadSchema, 'workspaceId'>;

export type BudgetSetupAllocation = {
  categoryId: string;
  categoryName: string;
  percentageOfIncome: number;
  groupName: string;
};

export type BudgetSetupResponse = {
  suggestedIncome: number;
  allocations: BudgetSetupAllocation[];
};

@Injectable()
export class GetBudgetSetupService implements Service<
  Request,
  Error,
  BudgetSetupResponse
> {
  constructor(private readonly budgetRepository: BudgetRepository) {}

  async execute(request: Request): Promise<Either<Error, BudgetSetupResponse>> {
    const [suggestedIncome, categories] = await Promise.all([
      this.budgetRepository.findMonthlyIncomeSuggestion(request.workspaceId),
      this.budgetRepository.findPresetCategories(request.workspaceId),
    ]);

    return right({
      suggestedIncome,
      allocations: buildPresetAllocations(categories),
    });
  }
}
