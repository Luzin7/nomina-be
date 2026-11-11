import { DatabaseModule } from '@infra/databases/Database.module';
import { AccountModule } from '@modules/account/Account.module';
import { Module } from '@nestjs/common';
import { DateModule } from '@providers/date/Date.module';
import { GetCardCyclePeriodsController } from './features/get-card-cycle-periods/get-card-cycle-periods.controller';
import { GetCardCyclePeriodsService } from './features/get-card-cycle-periods/get-card-cycle-periods.handler';
import { GetCardCycleStatusController } from './features/get-card-cycle-status/get-card-cycle-status.controller';
import { GetCardCycleStatusService } from './features/get-card-cycle-status/get-card-cycle-status.handler';
import { SaveCardCycleBudgetController } from './features/save-card-cycle-budget/save-card-cycle-budget.controller';
import { SaveCardCycleBudgetService } from './features/save-card-cycle-budget/save-card-cycle-budget.handler';

@Module({
  imports: [AccountModule, DateModule, DatabaseModule],
  controllers: [
    GetCardCycleStatusController,
    SaveCardCycleBudgetController,
    GetCardCyclePeriodsController,
  ],
  providers: [
    GetCardCycleStatusService,
    SaveCardCycleBudgetService,
    GetCardCyclePeriodsService,
  ],
  exports: [GetCardCycleStatusService],
})
export class CardCycleModule {}
