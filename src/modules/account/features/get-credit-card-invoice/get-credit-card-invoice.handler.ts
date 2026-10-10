import { TransactionStatus, TransactionType } from '@constants/enums';
import { CreditCard } from '@modules/account/entities/CreditCardAccount';
import {
  AccountNotFoundError,
  AccountTypeError,
} from '@modules/account/errors';
import { AccountRepository } from '@modules/account/repositories/contracts/AccountRepository';
import {
  InvoiceBounds,
  InvoiceCalendar,
  InvoiceKey,
  PlainDate,
} from '@modules/account/valueObjects/InvoiceCalendar';
import {
  buildInvoiceStatement,
  InvoiceStatement,
  StatementEntryKind,
} from '@modules/account/valueObjects/InvoiceStatement';
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
type InvoiceStatus = 'current' | 'closed' | 'overdue' | 'paid';

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

type DatedTransaction = { transaction: Transaction; date: PlainDate };

type InvoiceStatusInput = {
  statement: InvoiceStatement;
  key: InvoiceKey;
  currentKey: InvoiceKey;
  dueDate: PlainDate;
  today: PlainDate;
};

const invoiceKeyOf = (year: number, month: number): InvoiceKey =>
  `${year}-${String(month).padStart(2, '0')}`;

const entryKindOf = (
  transaction: Transaction,
  accountId: string,
): StatementEntryKind => {
  if (transaction.destinationAccountId === accountId) return 'payment';
  if (transaction.type === TransactionType.INCOME) return 'payment';
  return 'charge';
};

const isWithinPeriod = (date: PlainDate, bounds: InvoiceBounds): boolean =>
  date >= bounds.periodStart && date <= bounds.periodEnd;

const atLeastZero = (amount: bigint): bigint => (amount > 0n ? amount : 0n);

const invoiceStatusOf = ({
  statement,
  key,
  currentKey,
  dueDate,
  today,
}: InvoiceStatusInput): InvoiceStatus => {
  const hadAmountDue = statement.previousBalance > 0n || statement.charges > 0n;
  if (hadAmountDue && statement.remaining === 0n) return 'paid';
  if (key === currentKey) return 'current';
  if (dueDate < today) return 'overdue';
  return 'closed';
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

    const ledger = await this.datedLedgerOf(account, props.workspaceId);
    const statement = buildInvoiceStatement({
      calendar,
      key,
      today,
      entries: ledger
        .filter(
          ({ transaction }) =>
            transaction.status === TransactionStatus.COMPLETED,
        )
        .map(({ transaction, date }) => ({
          date,
          amount: transaction.amount,
          kind: entryKindOf(transaction, account.id),
        })),
    });

    const transactions = ledger
      .filter(({ date }) => isWithinPeriod(date, bounds))
      .map(({ transaction }) => transaction);
    const pendingAmount = this.pendingChargesOf(transactions, account.id);
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

  private async datedLedgerOf(
    account: CreditCard,
    workspaceId: string,
  ): Promise<DatedTransaction[]> {
    const ledger = await this.transactionRepository.findCreditCardLedger(
      account.id,
      workspaceId,
    );

    return ledger.map((transaction) => ({
      transaction,
      date: this.dateProvider.format(
        transaction.date,
        'YYYY-MM-DD',
        account.timezone,
      ),
    }));
  }

  private pendingChargesOf(
    transactions: Transaction[],
    accountId: string,
  ): bigint {
    return transactions
      .filter(
        (transaction) =>
          transaction.status === TransactionStatus.PENDING &&
          entryKindOf(transaction, accountId) === 'charge',
      )
      .reduce((sum, transaction) => sum + transaction.amount, 0n);
  }
}
