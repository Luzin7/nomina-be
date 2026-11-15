import { CreditCard } from '@modules/account/entities/CreditCardAccount';
import {
  AccountNotFoundError,
  AccountTypeError,
  CreditCardCycleNotConfiguredError,
} from '@modules/account/errors';
import { AccountRepository } from '@modules/account/repositories/contracts/AccountRepository';
import { CardInvoiceRepository } from '@modules/account/repositories/contracts/CardInvoiceRepository';
import { cardInvoiceWindowOf } from '@modules/account/valueObjects/CardInvoiceWindow';
import {
  InvoiceCalendar,
  InvoiceKey,
} from '@modules/account/valueObjects/InvoiceCalendar';
import {
  buildInvoiceStatementFromTotals,
  InvoiceStatus,
  invoiceStatusOf,
} from '@modules/account/valueObjects/InvoiceStatement';
import { Transaction } from '@modules/transaction/entities/Transaction';
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
  totalAmount: bigint;
  previousBalance: bigint;
  statementTotal: bigint;
  pendingAmount: bigint;
  availableLimit: bigint | null;
  dueDate: string;
  dueMonth: number;
  dueYear: number;
  periodStart: string;
  periodEnd: string;
  invoiceStatus: InvoiceStatus;
};

const invoiceKeyOf = (year: number, month: number): InvoiceKey =>
  `${year}-${String(month).padStart(2, '0')}`;

const atLeastZero = (amount: bigint): bigint => (amount > 0n ? amount : 0n);

@Injectable()
export class GetCreditCardInvoiceService implements Service<
  Request,
  Error,
  Response
> {
  constructor(
    private readonly accountRepository: AccountRepository,
    private readonly cardInvoiceRepository: CardInvoiceRepository,
    private readonly dateProvider: DateProvider,
  ) {}

  async execute(props: Request): Promise<Either<Error, Response>> {
    const account = await this.accountRepository.findById(props.accountId);

    if (!account) return left(new AccountNotFoundError());

    if (account.workspaceId !== props.workspaceId)
      return left(new UnauthorizedError());

    if (!(account instanceof CreditCard)) return left(new AccountTypeError());

    if (account.dueDay === null) {
      return left(new CreditCardCycleNotConfiguredError());
    }

    const calendar = new InvoiceCalendar({
      closingDaysBeforeDue: account.closingDaysBeforeDue,
      dueDay: account.dueDay,
    });

    const today = this.dateProvider.format(
      this.dateProvider.now(),
      'YYYY-MM-DD',
      account.timezone,
    );
    const currentKey = calendar.invoiceKeyFor(today);
    const key =
      props.month && props.year
        ? invoiceKeyOf(props.year, props.month)
        : currentKey;
    const bounds = calendar.bounds(key);
    const [year, month] = key.split('-').map(Number);
    const window = cardInvoiceWindowOf(account, calendar, key, today);

    const [[totals], transactions] = await Promise.all([
      this.cardInvoiceRepository.findTotals(props.workspaceId, [window]),
      this.cardInvoiceRepository.findPeriodTransactions(
        props.workspaceId,
        window,
      ),
    ]);
    const statement = buildInvoiceStatementFromTotals(totals);
    const pendingAmount = totals.pendingCharges;
    const totalAmount = statement.remaining;

    return right({
      account,
      transactions,
      totalAmount,
      previousBalance: statement.previousBalance,
      statementTotal: statement.total,
      pendingAmount,
      availableLimit:
        account.creditLimit === null
          ? null
          : atLeastZero(account.creditLimit - totalAmount - pendingAmount),
      dueDate: bounds.dueDate,
      dueMonth: month,
      dueYear: year,
      periodStart: bounds.periodStart,
      periodEnd: bounds.periodEnd,
      invoiceStatus: invoiceStatusOf({
        statement,
        key,
        currentKey,
        dueDate: bounds.dueDate,
        today,
      }),
    });
  }
}
