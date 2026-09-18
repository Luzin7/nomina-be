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
import { FindMonthSummaryController } from './features/get-month-summary/get-month-summary.controller';
import { FindMonthSummaryService } from './features/get-month-summary/get-month-summary.service';

@Module({
  imports: [DatabaseModule, DateModule, RedisModule, WorkspaceModule],
  controllers: [
    CashFlowEvolutionController,
    GetExpensesByCategoryController,
    BalanceEvolutionController,
    FindMonthSummaryController,
  ],
  providers: [
    CashFlowEvolutionService,
    GetExpensesByCategoryService,
    BalanceEvolutionService,
    FindMonthSummaryService,
  ],
})
export class ReportModule {}
