import { DatabaseModule } from '@infra/databases/Database.module';
import { FindMonthSummaryController } from '@modules/report/features/get-month-summary/get-month-summary.controller';
import { FindMonthSummaryService } from '@modules/report/features/get-month-summary/get-month-summary.service';
import { UserModule } from '@modules/user/User.module';
import { WorkspaceModule } from '@modules/workspace/Workspace.module';
import { Module } from '@nestjs/common';
import { DateModule } from '@providers/date/Date.module';
import { CreateRecurringTransactionController } from './features/create-recurring-transaction/create-recurring-transaction.controller';
import { CreateRecurringTransactionService } from './features/create-recurring-transaction/create-recurring-transaction.service';
import { CreateTransactionController } from './features/create-transaction/create-transaction.controller';
import { CreateTransactionService } from './features/create-transaction/create-transaction.service';
import { DeleteRecurringTransactionController } from './features/delete-recurring-transaction/delete-recurring-transaction.controller';
import { DeleteRecurringTransactionService } from './features/delete-recurring-transaction/delete-recurring-transaction.service';
import { DeleteTransactionController } from './features/delete-transaction/delete-transaction.controller';
import { DeleteTransactionService } from './features/delete-transaction/delete-transaction.service';
import { FindRecurringTransactionController } from './features/find-recurring-transaction/find-recurring-transaction.controller';
import { FindRecurringTransactionService } from './features/find-recurring-transaction/find-recurring-transaction.service';
import { FindTransactionController } from './features/find-transaction/find-transaction.controller';
import { FindTransactionByIdService } from './features/find-transaction/find-transaction.handle';
import { ListRecurringTransactionsController } from './features/list-recurring-transactions/list-recurring-transactions.controller';
import { ListRecurringTransactionsService } from './features/list-recurring-transactions/list-recurring-transactions.service';
import { ListTransactionController } from './features/list-transaction/list-transaction.controller';
import { ListTransactionsService } from './features/list-transaction/list-transaction.service';
import { ToggleActiveRecurringTransactionController } from './features/toggle-active-recurring-transaction/toggle-active-recurring-transaction.controller';
import { ToggleActiveRecurringTransactionService } from './features/toggle-active-recurring-transaction/toggle-active-recurring-transaction.service';
import { ToggleTransactionStatusController } from './features/toggle-transaction-status/toggle-transaction-status.controller';
import { ToggleTransactionStatusService } from './features/toggle-transaction-status/toggle-transaction-status.service';
import { UpdateRecurringTransactionController } from './features/update-recurring-transaction/update-recurring-transaction.controller';
import { UpdateRecurringTransactionService } from './features/update-recurring-transaction/update-recurring-transaction.service';
import { UpdateTransactionController } from './features/update-transaction/update-transaction.controller';
import { UpdateTransactionService } from './features/update-transaction/update-transaction.service';
import { GenerateRecurringTransactionJobController } from './jobs/create-recurring-transaction.controller';
import { GenerateRecurringTransactionsJobService } from './jobs/create-recurring-transaction.service';
import { CalculateNextGenerationDateService } from './services/calculate-next-generation-date.service';

@Module({
  controllers: [
    CreateTransactionController,
    DeleteTransactionController,
    FindMonthSummaryController,
    ListTransactionController,
    ListRecurringTransactionsController,
    FindTransactionController,
    UpdateTransactionController,
    ToggleTransactionStatusController,
    CreateRecurringTransactionController,
    GenerateRecurringTransactionJobController,
    UpdateRecurringTransactionController,
    DeleteRecurringTransactionController,
    FindRecurringTransactionController,
    ToggleActiveRecurringTransactionController,
  ],
  imports: [DatabaseModule, UserModule, WorkspaceModule, DateModule],
  providers: [
    CreateTransactionService,
    DeleteTransactionService,
    FindMonthSummaryService,
    FindTransactionByIdService,
    ListTransactionsService,
    UpdateTransactionService,
    ToggleTransactionStatusService,
    CreateRecurringTransactionService,
    UpdateRecurringTransactionService,
    DeleteRecurringTransactionService,
    ListRecurringTransactionsService,
    FindRecurringTransactionService,
    ToggleActiveRecurringTransactionService,
    CalculateNextGenerationDateService,
    GenerateRecurringTransactionsJobService,
  ],
})
export class TransactionModule {}
