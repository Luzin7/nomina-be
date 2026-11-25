import { DatabaseModule } from '@infra/databases/Database.module';
import { WorkspaceModule } from '@modules/workspace/Workspace.module';
import { Module } from '@nestjs/common';
import { DateModule } from '@providers/date/Date.module';
import { GetSpendableController } from './features/get-spendable/get-spendable.controller';
import { GetSpendableService } from './features/get-spendable/get-spendable.handler';

@Module({
  imports: [DatabaseModule, DateModule, WorkspaceModule],
  controllers: [GetSpendableController],
  providers: [GetSpendableService],
  exports: [GetSpendableService],
})
export class SpendableModule {}
