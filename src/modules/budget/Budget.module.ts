import { DatabaseModule } from '@infra/databases/Database.module';
import { ReportModule } from '@modules/report/Report.module';
import { WorkspaceModule } from '@modules/workspace/Workspace.module';
import { Module } from '@nestjs/common';
import { ResolveBudgetSuggestionService } from '@modules/budget/services/resolve-budget-suggestion.service';
import { DateModule } from '@providers/date/Date.module';
import { AcceptIncomeSuggestionController } from './features/accept-income-suggestion/accept-income-suggestion.controller';
import { AcceptIncomeSuggestionService } from './features/accept-income-suggestion/accept-income-suggestion.handler';
import { AcceptSplitSuggestionController } from './features/accept-split-suggestion/accept-split-suggestion.controller';
import { AcceptSplitSuggestionService } from './features/accept-split-suggestion/accept-split-suggestion.handler';
import { GetBudgetSuggestionController } from './features/get-budget-suggestion/get-budget-suggestion.controller';
import { GetBudgetSetupController } from './features/get-setup/get-setup.controller';
import { GetBudgetSetupService } from './features/get-setup/get-setup.handler';
import { GetBudgetStatusController } from './features/get-status/get-status.controller';
import { GetBudgetStatusService } from './features/get-status/get-status.handler';
import { RejectBudgetSuggestionController } from './features/reject-budget-suggestion/reject-budget-suggestion.controller';
import { RejectBudgetSuggestionService } from './features/reject-budget-suggestion/reject-budget-suggestion.handler';
import { SaveBudgetConfigController } from './features/save-config/save-config.controller';
import { SaveBudgetConfigService } from './features/save-config/save-config.handler';

@Module({
  imports: [DatabaseModule, ReportModule, WorkspaceModule, DateModule],
  controllers: [
    GetBudgetStatusController,
    SaveBudgetConfigController,
    GetBudgetSetupController,
    GetBudgetSuggestionController,
    AcceptIncomeSuggestionController,
    AcceptSplitSuggestionController,
    RejectBudgetSuggestionController,
  ],
  providers: [
    GetBudgetStatusService,
    SaveBudgetConfigService,
    GetBudgetSetupService,
    ResolveBudgetSuggestionService,
    AcceptIncomeSuggestionService,
    AcceptSplitSuggestionService,
    RejectBudgetSuggestionService,
  ],
  exports: [GetBudgetStatusService, ResolveBudgetSuggestionService],
})
export class BudgetModule {}
