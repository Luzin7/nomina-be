import { DatabaseModule } from '@infra/databases/Database.module';
import { UserModule } from '@modules/user/User.module';
import { WorkspaceModule } from '@modules/workspace/Workspace.module';
import { Module } from '@nestjs/common';
import { DateModule } from '@providers/date/Date.module';
import { CreateInstallmentPurchaseController } from './features/create-installment-purchase/create-installment-purchase.controller';
import { CreateInstallmentPurchaseService } from './features/create-installment-purchase/create-installment-purchase.service';
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
import { SetTransactionStatusController } from './features/set-transaction-status/set-transaction-status.controller';
import { SetTransactionStatusService } from './features/set-transaction-status/set-transaction-status.service';
import { ToggleActiveRecurringTransactionController } from './features/toggle-active-recurring-transaction/toggle-active-recurring-transaction.controller';
import { ToggleActiveRecurringTransactionService } from './features/toggle-active-recurring-transaction/toggle-active-recurring-transaction.service';
import { UpdateRecurringTransactionController } from './features/update-recurring-transaction/update-recurring-transaction.controller';
import { UpdateRecurringTransactionService } from './features/update-recurring-transaction/update-recurring-transaction.service';
import { UpdateTransactionController } from './features/update-transaction/update-transaction.controller';
import { UpdateTransactionService } from './features/update-transaction/update-transaction.service';
import { GenerateRecurringTransactionsJobController } from './jobs/generate-recurring-transactions/generate-recurring-transactions.controller';
import { GenerateRecurringTransactionsJobService } from './jobs/generate-recurring-transactions/generate-recurring-transactions.service';
import { ReconcileBalancesJobController } from './jobs/reconcile-balances/reconcile-balances.controller';
import { ReconcileBalancesJobService } from './jobs/reconcile-balances/reconcile-balances.service';
import { SettleCardInstallmentsJobController } from './jobs/settle-card-installments/settle-card-installments.controller';
import { SettleCardInstallmentsJobService } from './jobs/settle-card-installments/settle-card-installments.service';
import { CalculateNextGenerationDateService } from './services/calculate-next-generation-date.service';
import { NextGenerationDateCalculator } from './services/contracts/NextGenerationDateCalculator';

@Module({
  controllers: [
    CreateTransactionController,
    DeleteTransactionController,
    ListTransactionController,
    ListRecurringTransactionsController,
    FindTransactionController,
    UpdateTransactionController,
    SetTransactionStatusController,
    CreateRecurringTransactionController,
    CreateInstallmentPurchaseController,
    GenerateRecurringTransactionsJobController,
    ReconcileBalancesJobController,
    SettleCardInstallmentsJobController,
    UpdateRecurringTransactionController,
    DeleteRecurringTransactionController,
    FindRecurringTransactionController,
    ToggleActiveRecurringTransactionController,
  ],
  imports: [DatabaseModule, UserModule, WorkspaceModule, DateModule],
  providers: [
    CreateTransactionService,
    DeleteTransactionService,
    FindTransactionByIdService,
    ListTransactionsService,
    UpdateTransactionService,
    SetTransactionStatusService,
    CreateRecurringTransactionService,
    CreateInstallmentPurchaseService,
    UpdateRecurringTransactionService,
    DeleteRecurringTransactionService,
    ListRecurringTransactionsService,
    FindRecurringTransactionService,
    ToggleActiveRecurringTransactionService,
    {
      provide: NextGenerationDateCalculator,
      useClass: CalculateNextGenerationDateService,
    },
    GenerateRecurringTransactionsJobService,
    ReconcileBalancesJobService,
    SettleCardInstallmentsJobService,
  ],
})
export class TransactionModule {}
