import { CreditCard } from '@modules/account/entities/CreditCardAccount';
import {
  AccountNotFoundError,
  AccountTypeError,
  CreditCardCycleNotConfiguredError,
} from '@modules/account/errors';
import { AccountRepository } from '@modules/account/repositories/contracts/AccountRepository';
import { CardInvoiceRepository } from '@modules/account/repositories/contracts/CardInvoiceRepository';
import {
  cardInvoiceWindowOf,
  type CardInvoiceTotals,
  type CardInvoiceWindow,
} from '@modules/account/valueObjects/CardInvoiceWindow';
import {
  InvoiceCalendar,
  type InvoiceBounds,
  type InvoiceKey,
  type PlainDate,
} from '@modules/account/valueObjects/InvoiceCalendar';
import {
  openInvoiceOf,
  payableInvoiceOf,
} from '@modules/account/valueObjects/OpenInvoice';
import { CycleWindow } from '@modules/spendable/valueObjects/CycleWindow';
import { WorkspaceNotFoundError } from '@modules/workspace/errors';
import { GetWorkspaceCycleService } from '@modules/workspace/services/get-workspace-cycle.service';
import { GetWorkspaceTimezoneService } from '@modules/workspace/services/get-workspace-timezone.service';
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

type ResolvedInvoice = {
  bounds: InvoiceBounds;
  totals: CardInvoiceTotals;
  window: CardInvoiceWindow;
};

type CardContext = {
  account: CreditCard;
  calendar: InvoiceCalendar;
  today: PlainDate;
  workspaceId: string;
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
    private readonly workspaceCycle: GetWorkspaceCycleService,
    private readonly workspaceTimezone: GetWorkspaceTimezoneService,
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

    const timezone = await this.workspaceTimezone.execute(props.workspaceId);
    const today = this.localTodayOf(timezone);
    const currentKey = calendar.invoiceKeyFor(today);
    const context = {
      account,
      calendar,
      today,
      workspaceId: props.workspaceId,
    };
    const resolved =
      props.month && props.year
        ? await this.requestedInvoiceOf(context, props.month, props.year)
        : await this.defaultInvoiceOf(context);

    if (resolved === null) return left(new WorkspaceNotFoundError());

    const { bounds, totals, window } = resolved;

    const transactions =
      await this.cardInvoiceRepository.findPeriodTransactions(
        props.workspaceId,
        window,
      );
    const statement = buildInvoiceStatementFromTotals(totals);
    const pendingAmount = totals.pendingCharges;
    const totalAmount = statement.remaining;
    const [dueYear, dueMonth] = bounds.key.split('-').map(Number);

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
      dueMonth,
      dueYear,
      periodStart: bounds.periodStart,
      periodEnd: bounds.periodEnd,
      invoiceStatus: invoiceStatusOf({
        statement,
        key: bounds.key,
        currentKey,
        dueDate: bounds.dueDate,
        today,
      }),
    });
  }

  private async requestedInvoiceOf(
    { account, calendar, today, workspaceId }: CardContext,
    month: number,
    year: number,
  ): Promise<ResolvedInvoice> {
    const bounds = calendar.bounds(invoiceKeyOf(year, month));
    const window = cardInvoiceWindowOf(account, calendar, bounds.key, today);
    const [totals] = await this.cardInvoiceRepository.findTotals(workspaceId, [
      window,
    ]);

    return { bounds, totals, window };
  }

  private async defaultInvoiceOf({
    account,
    calendar,
    today,
    workspaceId,
  }: CardContext): Promise<ResolvedInvoice | null> {
    const cycle = await this.workspaceCycle.execute(workspaceId);
    if (cycle === null) return null;

    const cycleWindow = CycleWindow.of(today, cycle);
    const current = calendar.bounds(calendar.invoiceKeyFor(today));
    const candidate = openInvoiceOf(calendar, current, cycleWindow);
    const keys =
      candidate.key !== current.key
        ? [candidate.key, current.key]
        : [current.key];
    const windows = keys.map((key) =>
      cardInvoiceWindowOf(account, calendar, key, today),
    );
    const totals = await this.cardInvoiceRepository.findTotals(
      workspaceId,
      windows,
    );
    const statementOf = (key: InvoiceKey) =>
      buildInvoiceStatementFromTotals(totals[keys.indexOf(key)]);
    const bounds = payableInvoiceOf(
      current,
      candidate,
      (key) => statementOf(key).remaining,
    );
    const index = keys.indexOf(bounds.key);

    return { bounds, totals: totals[index], window: windows[index] };
  }

  private localTodayOf(timezone: string): PlainDate {
    return this.dateProvider.format(
      this.dateProvider.now(),
      'YYYY-MM-DD',
      timezone,
    );
  }
}
