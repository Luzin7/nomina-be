import { DatabaseModule } from '@infra/databases/Database.module';
import { PayCreditCardInvoiceService } from '@modules/transaction/features/pay-credit-card-invoice/pay-credit-card-invoice.service';
import { Module } from '@nestjs/common';
import { SubscriptionModule } from '../subscription/Subscription.module';
import { PayCreditCardInvoiceController } from '../transaction/features/pay-credit-card-invoice/pay-credit-card-invoice.controller';
import { AdjustAccountBalanceController } from './features/adjust-account-balance/adjust-account-balance.controller';
import { AdjustAccountBalanceService } from './features/adjust-account-balance/adjust-account-balance.service';
import { CreateAccountController } from './features/create-account/create-account.controller';
import { CreateAccountService } from './features/create-account/create-account.service';
import { DeleteAccountController } from './features/delete-account/delete-account.controller';
import { DeleteAccountService } from './features/delete-account/delete-account.handler';
import { FindAccountController } from './features/find-account/find-account.controller';
import { FindAccountByIdService } from './features/find-account/find-account.handler';
import { GetCreditCardInvoiceController } from './features/get-credit-card-invoice/get-credit-card-invoice.controller';
import { GetCreditCardInvoiceService } from './features/get-credit-card-invoice/get-credit-card-invoice.handler';
import { ListAccountsController } from './features/list-accounts/list-accounts.controller';
import { ListAccountsService } from './features/list-accounts/list-accounts.service';
import { ListBalanceAdjustmentsController } from './features/list-balance-adjustments/list-balance-adjustments.controller';
import { ListBalanceAdjustmentsService } from './features/list-balance-adjustments/list-balance-adjustments.service';
import { ListOpenCardInvoicesController } from './features/list-open-card-invoices/list-open-card-invoices.controller';
import { ListOpenCardInvoicesService } from './features/list-open-card-invoices/list-open-card-invoices.handler';
import { SetAutopayController } from './features/set-autopay/set-autopay.controller';
import { SetAutopayService } from './features/set-autopay/set-autopay.service';
import { UpdateAccountController } from './features/update-account/update-account.controller';
import { UpdateAccountService } from './features/update-account/update-account.service';
import { DateModule } from '@providers/date/Date.module';
@Module({
  imports: [DatabaseModule, SubscriptionModule, DateModule],
  controllers: [
    CreateAccountController,
    UpdateAccountController,
    SetAutopayController,
    DeleteAccountController,
    FindAccountController,
    ListAccountsController,
    ListOpenCardInvoicesController,
    GetCreditCardInvoiceController,
    PayCreditCardInvoiceController,
    AdjustAccountBalanceController,
    ListBalanceAdjustmentsController,
  ],
  providers: [
    CreateAccountService,
    UpdateAccountService,
    SetAutopayService,
    DeleteAccountService,
    FindAccountByIdService,
    ListAccountsService,
    ListOpenCardInvoicesService,
    GetCreditCardInvoiceService,
    PayCreditCardInvoiceService,
    AdjustAccountBalanceService,
    ListBalanceAdjustmentsService,
  ],
  exports: [
    CreateAccountService,
    UpdateAccountService,
    DeleteAccountService,
    FindAccountByIdService,
    ListAccountsService,
    GetCreditCardInvoiceService,
    PayCreditCardInvoiceService,
  ],
})
export class AccountModule {}
