import { TransactionStatus } from '@constants/enums';
import { CreditCard } from '@modules/account/entities/CreditCardAccount';
import {
  AccountNotFoundError,
  InvalidAccountError,
} from '@modules/account/errors';
import { AccountRepository } from '@modules/account/repositories/contracts/AccountRepository';
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

  async execute(props: Request): Promise<Either<Error, Transaction>> {
    const creditCardAccount = await this.accountRepository.findById(
      props.creditCardAccountId,
    );
    if (creditCardAccount?.workspaceId !== props.workspaceId) {
      return left(new AccountNotFoundError());
    }
    if (!(creditCardAccount instanceof CreditCard)) {
      return left(
        new InvalidAccountError(
          'A conta de destino deve ser um cartão de crédito.',
        ),
      );
    }

    if (props.sourceAccountId === props.creditCardAccountId) {
      return left(new SourceAndDestinationAccountMustBeDifferentError());
    }
    const sourceAccount = await this.accountRepository.findById(
      props.sourceAccountId,
    );
    if (sourceAccount?.workspaceId !== props.workspaceId) {
      return left(new AccountNotFoundError('Conta de origem não encontrada.'));
    }
    if (sourceAccount instanceof CreditCard) {
      return left(new CannotPayInvoiceWithCreditCardError());
    }

    const amountBigInt = BigInt(props.amount);
    const tz = sourceAccount.timezone;
    const today = this.dateProvider.startOfDay(this.dateProvider.now(), tz);

    const paymentDate = this.resolvePaymentDate(props, creditCardAccount, today);

    const transactionOrError = Transaction.create({
      workspaceId: props.workspaceId,
      accountId: props.sourceAccountId,
      destinationAccountId: props.creditCardAccountId,
      categoryId: props.categoryId ?? '0d19bbf8-b66a-4cc2-9c7c-3fcd961f06b1',
      title: 'Pagamento de Fatura',
      description:
        props.description ?? `Pagamento da fatura: ${creditCardAccount.name}`,
      amount: amountBigInt,
      date: paymentDate,
      type: 'TRANSFER',
      status: TransactionStatus.COMPLETED,
    });

    if (transactionOrError.isLeft()) return left(transactionOrError.value);
    const transaction = transactionOrError.value;

    const debitResult = sourceAccount.debit(amountBigInt);
    if (debitResult.isLeft()) return left(debitResult.value);

    const paymentResult = creditCardAccount.payInvoice(amountBigInt);
    if (paymentResult.isLeft()) return left(paymentResult.value);

    await this.transactionRepository.createWithBalanceUpdate(
      transaction,
      Number(sourceAccount.balance),
      Number(creditCardAccount.balance),
    );

    return right(transaction);
  }

  /**
   * A fatura de um cartão é calculada por período (ver GetCreditCardInvoiceService),
   * somando cobranças e pagamentos cuja `date` cai dentro do ciclo. Se o pagamento
   * for datado com "hoje" mesmo quando o usuário está quitando uma fatura de um
   * ciclo já fechado (ex.: pagar em agosto a fatura de julho), a transação de
   * pagamento cai no ciclo errado e a fatura paga nunca reflete o pagamento.
   * Quando o cliente informa `month`/`year`, ancoramos o pagamento no fim daquele
   * ciclo para que ele seja contabilizado na fatura correta.
   */
  private resolvePaymentDate(
    props: Request,
    creditCardAccount: CreditCard,
    today: Date,
  ): Date {
    if (!props.month || !props.year) return today;

    const referenceDate = new Date(Date.UTC(props.year, props.month - 1, 1));
    const { periodEnd } = this.dateProvider.calculateInvoiceCycle({
      referenceDate,
      closingDaysBeforeDue: creditCardAccount.closingDaysBeforeDue,
      dueDay: creditCardAccount.dueDay,
      timezone: creditCardAccount.timezone,
    });

    return periodEnd < today ? periodEnd : today;
  }
}
