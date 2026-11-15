import { DatabaseModule } from '@infra/databases/Database.module';
import { ResolveBudgetSuggestionService } from '@modules/budget/services/resolve-budget-suggestion.service';
import { WorkspaceModule } from '@modules/workspace/Workspace.module';
import { Module } from '@nestjs/common';
import { DateModule } from '@providers/date/Date.module';
import { SingleFlight } from '@shared/cache/single-flight';

@Module({
  imports: [DatabaseModule, WorkspaceModule, DateModule],
  providers: [ResolveBudgetSuggestionService, SingleFlight],
  exports: [ResolveBudgetSuggestionService],
})
export class BudgetSuggestionModule {}
