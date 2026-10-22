import { TransactionStatus } from '@constants/enums';
import { CreditCard } from '@modules/account/entities/CreditCardAccount';
import { AnyAccount } from '@modules/account/entities/types';
import {
  AccountNotFoundError,
  InvalidAccountError,
} from '@modules/account/errors';
import { AccountRepository } from '@modules/account/repositories/contracts/AccountRepository';
import { allocateInvoice } from '@modules/account/valueObjects/InvoiceAllocation';
import { InvoiceCalendar } from '@modules/account/valueObjects/InvoiceCalendar';
import { SYSTEM_CATEGORY } from '@modules/category/constants/system-categories';
import { Transaction } from '@modules/transaction/entities/Transaction';
import {
  CannotPayInvoiceWithCreditCardError,
  SourceAndDestinationAccountMustBeDifferentError,
} from '@modules/transaction/errors';
import { TransactionRepository } from '@modules/transaction/repositories/contracts/TransactionRepository';
import { Injectable } from '@nestjs/common';
import { TokenPayloadBase } from '@providers/auth/strategys/jwtStrategy';
import { DateProvider } from '@providers/date/contracts/DateProvider';
import { Service } from '@shared/core/contracts/Service';
import { Either, left, right } from '@shared/core/errors/Either';
import { PayCreditCardInvoiceRequest } from './pay-credit-card-invoice.dto';

type Request = PayCreditCardInvoiceRequest &
  TokenPayloadBase & { creditCardAccountId: string };

@Injectable()
export class PayCreditCardInvoiceService implements Service<
  Request,
  Error,
  Transaction
> {
  constructor(
    private readonly accountRepository: AccountRepository,
    private readonly transactionRepository: TransactionRepository,
    private readonly dateProvider: DateProvider,
  ) {}

  private async validateSourceAccount({
    sourceAccountId,
    workspaceId,
  }: Request): Promise<Either<Error, AnyAccount>> {
    const sourceAccount =
      await this.accountRepository.findById(sourceAccountId);
    if (sourceAccount?.workspaceId !== workspaceId) {
      return left(new AccountNotFoundError('Conta de origem não encontrada.'));
    }
    if (sourceAccount instanceof CreditCard) {
      return left(new CannotPayInvoiceWithCreditCardError());
    }

    return right(sourceAccount);
  }

  private async validateDestinationAccount({
    creditCardAccountId,
    workspaceId,
    sourceAccountId,
  }: Request): Promise<Either<Error, CreditCard>> {
    const creditCardAccount =
      await this.accountRepository.findById(creditCardAccountId);
    if (creditCardAccount?.workspaceId !== workspaceId) {
      return left(new AccountNotFoundError());
    }
    if (sourceAccountId === creditCardAccountId) {
      return left(new SourceAndDestinationAccountMustBeDifferentError());
    }
    if (!(creditCardAccount instanceof CreditCard)) {
      return left(
        new InvalidAccountError(
          'A conta de destino deve ser um cartão de crédito.',
        ),
      );
    }

    return right(creditCardAccount);
  }

  async execute(props: Request): Promise<Either<Error, Transaction>> {
    const creditCardAccountOrError =
      await this.validateDestinationAccount(props);
    if (creditCardAccountOrError.isLeft())
      return left(creditCardAccountOrError.value);
    const creditCardAccount = creditCardAccountOrError.value;

    const sourceAccountOrError = await this.validateSourceAccount(props);
    if (sourceAccountOrError.isLeft()) return left(sourceAccountOrError.value);
    const sourceAccount = sourceAccountOrError.value;

    const amountBigInt = BigInt(props.amount);
    const now = this.dateProvider.now();
    const today = this.dateProvider.startOfDay(now, creditCardAccount.timezone);
    const paidAt = this.dateProvider.format(
      now,
      'DD/MM/YYYY - HH:mm:ss',
      creditCardAccount.timezone,
    );

    const invoiceKey = allocateInvoice({
      calendar: new InvoiceCalendar({
        closingDaysBeforeDue: creditCardAccount.closingDaysBeforeDue,
        dueDay: creditCardAccount.dueDay,
      }),
      paymentDate: this.dateProvider.format(
        now,
        'YYYY-MM-DD',
        creditCardAccount.timezone,
      ),
      explicitTarget: this.explicitInvoiceKey(props),
    });

    const transactionOrError = Transaction.create({
      workspaceId: props.workspaceId,
      accountId: props.sourceAccountId,
      destinationAccountId: props.creditCardAccountId,
      categoryId: props.categoryId ?? SYSTEM_CATEGORY.CREDIT_CARD_PAYMENT.id,
      title: `Pagamento de Fatura ${creditCardAccount.name} (${invoiceKey})`,
      description:
        props.description ??
        `Pagamento da fatura: ${creditCardAccount.name} - (${invoiceKey}) - ${paidAt}`,
      amount: amountBigInt,
      date: today,
      type: 'TRANSFER',
      status: TransactionStatus.COMPLETED,
      invoicePeriodMonth: Number(invoiceKey.slice(5, 7)),
      invoicePeriodYear: Number(invoiceKey.slice(0, 4)),
    });

    if (transactionOrError.isLeft()) return left(transactionOrError.value);
    const transaction = transactionOrError.value;

    const sourceBalanceBefore = sourceAccount.balance;
    const creditCardBalanceBefore = creditCardAccount.balance;

    const debitResult = sourceAccount.debit(amountBigInt);
    if (debitResult.isLeft()) return left(debitResult.value);

    const paymentResult = creditCardAccount.payInvoice(amountBigInt);
    if (paymentResult.isLeft()) return left(paymentResult.value);

    await this.transactionRepository.createWithBalanceUpdate(
      transaction,
      sourceAccount.balance - sourceBalanceBefore,
      creditCardAccount.balance - creditCardBalanceBefore,
    );

    return right(transaction);
  }

  private explicitInvoiceKey(props: Request): string | undefined {
    if (!props.month || !props.year) return undefined;
    return `${props.year}-${String(props.month).padStart(2, '0')}`;
  }
}
