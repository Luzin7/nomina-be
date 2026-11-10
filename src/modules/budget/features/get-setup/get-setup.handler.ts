import { BUDGET_MODE_DEFAULT, type BudgetMode } from '@constants/enums';
import { BudgetRepository } from '@modules/budget/repositories/contracts/BudgetRepository';
import { buildPresetAllocations } from '@modules/budget/valueObjects/BudgetPreset';
import { GetWorkspaceTimezoneService } from '@modules/workspace/services/get-workspace-timezone.service';
import { Injectable } from '@nestjs/common';
import { TokenPayloadSchema } from '@providers/auth/strategys/jwtStrategy';
import { DateProvider } from '@providers/date/contracts/DateProvider';
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
  mode: BudgetMode;
  suggestedIncome: number;
  allocations: BudgetSetupAllocation[];
};

@Injectable()
export class GetBudgetSetupService implements Service<
  Request,
  Error,
  BudgetSetupResponse
> {
  constructor(
    private readonly budgetRepository: BudgetRepository,
    private readonly workspaceTimezone: GetWorkspaceTimezoneService,
    private readonly dateProvider: DateProvider,
  ) {}

  async execute(request: Request): Promise<Either<Error, BudgetSetupResponse>> {
    const [timezone, suggestedIncome, categories] = await Promise.all([
      this.workspaceTimezone.execute(request.workspaceId),
      this.budgetRepository.findMonthlyIncomeSuggestion(request.workspaceId),
      this.budgetRepository.findPresetCategories(request.workspaceId),
    ]);

    const currentMonthStart = this.dateProvider.startOfMonth(
      this.dateProvider.now(),
      timezone,
    );
    const snapshot = await this.budgetRepository.resolveSnapshot(
      request.workspaceId,
      currentMonthStart,
    );

    return right({
      mode: snapshot?.mode ?? BUDGET_MODE_DEFAULT,
      suggestedIncome,
      allocations: buildPresetAllocations(categories),
    });
  }
}
