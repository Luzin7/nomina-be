import { TransactionStatus } from '@constants/enums';
import { CreditCard } from '@modules/account/entities/CreditCardAccount';
import {
  AccountNotFoundError,
  AccountTypeError,
} from '@modules/account/errors';
import { AccountRepository } from '@modules/account/repositories/contracts/AccountRepository';
import { InvoiceCalendar } from '@modules/account/valueObjects/InvoiceCalendar';
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
type InvoiceStatus = 'current' | 'closed' | 'overdue';

type Response = {
  account: CreditCard;
  transactions: Transaction[];
  totalAmount: number;
  pendingAmount: number;
  availableLimit: number | null;
  dueDate: string;
  dueMonth: number;
  dueYear: number;
  periodStart: string;
  periodEnd: string;
  invoiceStatus: InvoiceStatus;
};

const invoiceKeyOf = (year: number, month: number): string =>
  `${year}-${String(month).padStart(2, '0')}`;

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

    const timezone = account.timezone ?? 'America/Sao_Paulo';
    const calendar = new InvoiceCalendar({
      closingDaysBeforeDue: account.closingDaysBeforeDue,
      dueDay: account.dueDay,
    });

    const today = this.dateProvider.format(
      this.dateProvider.now(),
      'YYYY-MM-DD',
      timezone,
    );
    const currentKey = calendar.invoiceKeyFor(today);
    const key =
      props.month && props.year
        ? invoiceKeyOf(props.year, props.month)
        : currentKey;
    const bounds = calendar.bounds(key);
    const [year, month] = key.split('-').map(Number);

    const [charges, payments] = await Promise.all([
      this.transactionRepository.findChargesByPeriod(
        props.accountId,
        props.workspaceId,
        this.dateProvider.startOfDay(bounds.periodStart, timezone),
        this.dateProvider.startOfDay(bounds.endExclusive, timezone),
      ),
      this.transactionRepository.findPaymentsByInvoice(
        props.accountId,
        props.workspaceId,
        { month, year },
      ),
    ]);

    const transactions = [...charges, ...payments];

    const chargesTotal = charges
      .filter((t) => t.status === TransactionStatus.COMPLETED)
      .reduce((sum, t) => sum + Number(t.amount), 0);

    const paymentsTotal = payments
      .filter((t) => t.status === TransactionStatus.COMPLETED)
      .reduce((sum, t) => sum + Number(t.amount), 0);

    const totalAmount = Math.max(chargesTotal - paymentsTotal, 0);

    const pendingAmount = charges
      .filter((t) => t.status === TransactionStatus.PENDING)
      .reduce((sum, t) => sum + Number(t.amount), 0);

    const availableLimit =
      account.creditLimit === null
        ? null
        : Math.max(
            0,
            Number(account.creditLimit) - totalAmount - pendingAmount,
          );

    let invoiceStatus: InvoiceStatus;
    if (key === currentKey) {
      invoiceStatus = 'current';
    } else if (bounds.dueDate < today) {
      invoiceStatus = 'overdue';
    } else {
      invoiceStatus = 'closed';
    }

    return right({
      account,
      transactions,
      totalAmount,
      pendingAmount,
      availableLimit,
      dueDate: bounds.dueDate,
      dueMonth: month,
      dueYear: year,
      periodStart: bounds.periodStart,
      periodEnd: bounds.periodEnd,
      invoiceStatus,
    });
  }
}
