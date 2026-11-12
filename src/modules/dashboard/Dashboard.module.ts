import { DatabaseModule } from '@infra/databases/Database.module';
import { AccountModule } from '@modules/account/Account.module';
import { BudgetModule } from '@modules/budget/Budget.module';
import { ReportModule } from '@modules/report/Report.module';
import { WorkspaceModule } from '@modules/workspace/Workspace.module';
import { Module } from '@nestjs/common';
import { DateModule } from '@providers/date/Date.module';
import { GetAvailableToSpendController } from './features/get-available-to-spend/get-available-to-spend.controller';
import { GetAvailableToSpendService } from './features/get-available-to-spend/get-available-to-spend.handler';
import { CardBillDueInsightService } from './services/card-bill-due-insight.service';
import { ProjectionShortfallInsightService } from './services/projection-shortfall-insight.service';

@Module({
  imports: [
    AccountModule,
    BudgetModule,
    DatabaseModule,
    ReportModule,
    WorkspaceModule,
    DateModule,
  ],
  controllers: [GetAvailableToSpendController],
  providers: [
    GetAvailableToSpendService,
    CardBillDueInsightService,
    ProjectionShortfallInsightService,
  ],
})
export class DashboardModule {}
