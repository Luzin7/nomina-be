import { TransactionStatus } from '@constants/enums';
import { CreditCard } from '@modules/account/entities/CreditCardAccount';
import {
  AccountNotFoundError,
  AccountTypeError,
} from '@modules/account/errors';
import { AccountRepository } from '@modules/account/repositories/contracts/AccountRepository';
import { Transaction } from '@modules/transaction/entities/Transaction';
import { TransactionRepository } from '@modules/transaction/repositories/contracts/TransactionRepository';
import { Injectable } from '@nestjs/common';
import { TokenPayloadBase } from '@providers/auth/strategys/jwtStrategy';
import { DateProvider } from '@providers/date/contracts/DateProvider';
import { Service } from '@shared/core/contracts/Service';
import { Either, left, right } from '@shared/core/errors/Either';
import { UnauthorizedError } from '@shared/errors/UnauthorizedError';
import { GetCreditCardInvoiceRequest } from './get-credit-card-invoice.dto';

type Request = GetCreditCardInvoiceRequest &
  TokenPayloadBase & { accountId: string };
type Response = {
  account: CreditCard;
  transactions: Transaction[];
  totalAmount: number;
  pendingAmount: number;
  availableLimit: number | null;
  dueDate: Date;
  periodStart: Date;
  periodEnd: Date;
};

@Injectable()
export class GetCreditCardInvoiceService implements Service<
  Request,
  Error,
  Response
> {
  constructor(
    private readonly accountRepository: AccountRepository,
    private readonly transactionRepository: TransactionRepository,
    private readonly dateProvider: DateProvider,
  ) {}

  async execute(props: Request): Promise<Either<Error, Response>> {
    const account = await this.accountRepository.findById(props.accountId);

    if (!account) return left(new AccountNotFoundError());

    if (account.workspaceId !== props.workspaceId)
      return left(new UnauthorizedError());

    if (!(account instanceof CreditCard)) return left(new AccountTypeError());

    const institutionTimezone = account.timezone ?? 'America/Sao_Paulo';

    const referenceDate =
      props.month && props.year
        ? new Date(Date.UTC(props.year, props.month - 1, 1))
        : this.dateProvider.now();

    const { periodStart, periodEnd, dueDate } =
      this.dateProvider.calculateInvoiceCycle({
        referenceDate,
        closingDaysBeforeDue: account.closingDaysBeforeDue,
        dueDay: account.dueDay,
        timezone: institutionTimezone,
      });

    const transactions =
      await this.transactionRepository.findByAccountAndDateRange(
        props.accountId,
        props.workspaceId,
        periodStart,
        periodEnd,
      );

    const chargesTotal = transactions
      .filter(
        (t) =>
          t.status === TransactionStatus.COMPLETED &&
          t.accountId === props.accountId,
      )
      .reduce((sum, t) => sum + Number(t.amount), 0);

    const paymentsTotal = transactions
      .filter(
        (t) =>
          t.status === TransactionStatus.COMPLETED &&
          t.destinationAccountId === props.accountId,
      )
      .reduce((sum, t) => sum + Number(t.amount), 0);

    const totalAmount = Math.max(chargesTotal - paymentsTotal, 0);

    const pendingAmount = transactions
      .filter(
        (t) =>
          t.status === TransactionStatus.PENDING &&
          t.accountId === props.accountId,
      )
      .reduce((sum, t) => sum + Number(t.amount), 0);

    const availableLimit =
      account.creditLimit === null
        ? null
        : Number(account.creditLimit) - totalAmount - pendingAmount;

    return right({
      account,
      transactions,
      totalAmount,
      pendingAmount,
      availableLimit,
      dueDate,
      periodStart,
      periodEnd,
    });
  }
}
