import { DatabaseModule } from '@infra/databases/Database.module';
import { CreateGoalController } from '@modules/goal/features/create-goal/create-goal.controller';
import { CreateGoalService } from '@modules/goal/features/create-goal/create-goal.service';
import { DeleteGoalController } from '@modules/goal/features/delete-goal/delete-goal.controller';
import { DeleteGoalService } from '@modules/goal/features/delete-goal/delete-goal.service';
import { GetGoalsSummaryController } from '@modules/goal/features/get-goals-summary/get-goals-summary.controller';
import { GetGoalsSummaryService } from '@modules/goal/features/get-goals-summary/get-goals-summary.service';
import { ListGoalsController } from '@modules/goal/features/list-goals/list-goals.controller';
import { ListGoalsService } from '@modules/goal/features/list-goals/list-goals.service';
import { UpdateGoalController } from '@modules/goal/features/update-goal/update-goal.controller';
import { UpdateGoalService } from '@modules/goal/features/update-goal/update-goal.service';
import { GoalRepository } from '@modules/goal/repositories/contracts/GoalRepository';
import { ValidateGoalLinksService } from '@modules/goal/services/validate-goal-links.service';
import { WorkspaceModule } from '@modules/workspace/Workspace.module';
import { Module } from '@nestjs/common';
import { DateModule } from '@providers/date/Date.module';

@Module({
  imports: [DatabaseModule, WorkspaceModule, DateModule],
  controllers: [
    CreateGoalController,
    ListGoalsController,
    UpdateGoalController,
    DeleteGoalController,
    GetGoalsSummaryController,
  ],
  providers: [
    CreateGoalService,
    ListGoalsService,
    UpdateGoalService,
    DeleteGoalService,
    GetGoalsSummaryService,
    ValidateGoalLinksService,
  ],
  exports: [GoalRepository],
})
export class GoalModule {}
