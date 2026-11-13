import { RedisModule } from '@infra/cache/Redis.module';
import { DatabaseModule } from '@infra/databases/Database.module';
import { Module } from '@nestjs/common';
import { DateModule } from '@providers/date/Date.module';
import { WorkspaceModule } from '@modules/workspace/Workspace.module';
import { BalanceEvolutionController } from './features/get-balance-evolution/get-balance-evolution.controller';
import { BalanceEvolutionService } from './features/get-balance-evolution/get-balance-evolution.handler';
import { CashFlowEvolutionController } from './features/get-cash-flow-evolution/cash-flow-evolution.controller';
import { CashFlowEvolutionService } from './features/get-cash-flow-evolution/cash-flow-evolution.handler';
import { GetExpensesByCategoryController } from './features/get-expenses-by-category/get-expenses-by-category.controller';
import { GetExpensesByCategoryService } from './features/get-expenses-by-category/get-expenses-by-category.handler';
import { GetMonthPaceController } from './features/get-month-pace/get-month-pace.controller';
import { GetMonthPaceService } from './features/get-month-pace/get-month-pace.handler';
import { FindMonthSummaryController } from './features/get-month-summary/get-month-summary.controller';
import { FindMonthSummaryService } from './features/get-month-summary/get-month-summary.service';
import { GetProjectionController } from './features/get-projection/get-projection.controller';
import { GetProjectionService } from './features/get-projection/get-projection.handler';

@Module({
  imports: [DatabaseModule, DateModule, RedisModule, WorkspaceModule],
  controllers: [
    CashFlowEvolutionController,
    GetExpensesByCategoryController,
    BalanceEvolutionController,
    FindMonthSummaryController,
    GetProjectionController,
    GetMonthPaceController,
  ],
  providers: [
    CashFlowEvolutionService,
    GetExpensesByCategoryService,
    BalanceEvolutionService,
    FindMonthSummaryService,
    GetProjectionService,
    GetMonthPaceService,
  ],
  exports: [FindMonthSummaryService, GetProjectionService],
})
export class ReportModule {}
