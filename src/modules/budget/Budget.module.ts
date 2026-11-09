import { DatabaseModule } from '@infra/databases/Database.module';
import { ReportModule } from '@modules/report/Report.module';
import { WorkspaceModule } from '@modules/workspace/Workspace.module';
import { Module } from '@nestjs/common';
import { DateModule } from '@providers/date/Date.module';
import { GetBudgetSetupController } from './features/get-setup/get-setup.controller';
import { GetBudgetSetupService } from './features/get-setup/get-setup.handler';
import { GetBudgetStatusController } from './features/get-status/get-status.controller';
import { GetBudgetStatusService } from './features/get-status/get-status.handler';
import { SaveBudgetConfigController } from './features/save-config/save-config.controller';
import { SaveBudgetConfigService } from './features/save-config/save-config.handler';

@Module({
  imports: [DatabaseModule, ReportModule, WorkspaceModule, DateModule],
  controllers: [
    GetBudgetStatusController,
    SaveBudgetConfigController,
    GetBudgetSetupController,
  ],
  providers: [
    GetBudgetStatusService,
    SaveBudgetConfigService,
    GetBudgetSetupService,
  ],
})
export class BudgetModule {}
