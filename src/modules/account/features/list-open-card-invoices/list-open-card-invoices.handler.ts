import { CreditCard } from '@modules/account/entities/CreditCardAccount';
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
import {
  buildInvoiceStatementFromTotals,
  type InvoiceStatement,
  InvoiceStatus,
  invoiceStatusOf,
} from '@modules/account/valueObjects/InvoiceStatement';
import { CycleWindow } from '@modules/spendable/valueObjects/CycleWindow';
import { WorkspaceNotFoundError } from '@modules/workspace/errors';
import { GetWorkspaceCycleService } from '@modules/workspace/services/get-workspace-cycle.service';
import { GetWorkspaceTimezoneService } from '@modules/workspace/services/get-workspace-timezone.service';
import { Injectable } from '@nestjs/common';
import { DateProvider } from '@providers/date/contracts/DateProvider';
import { Service } from '@shared/core/contracts/Service';
import { Either, left, right } from '@shared/core/errors/Either';

type Request = { workspaceId: string };

export type OpenCardInvoice = {
  account: CreditCard;
  key: InvoiceKey;
  totalAmount: bigint;
  previousBalance: bigint;
  statementTotal: bigint;
  pendingAmount: bigint;
  dueDate: string;
  periodStart: string;
  periodEnd: string;
  invoiceStatus: InvoiceStatus;
};

type Response = { invoices: OpenCardInvoice[] };

type CardWithCycle = { card: CreditCard; calendar: InvoiceCalendar };

type OpenBillOfCard = {
  card: CreditCard;
  today: PlainDate;
  current: InvoiceBounds;
  candidate: InvoiceBounds;
  keys: InvoiceKey[];
  windows: CardInvoiceWindow[];
};

type BillWithTotals = OpenBillOfCard & { totals: CardInvoiceTotals[] };

const hasConfiguredCycle = (
  account: unknown,
): account is CreditCard & { dueDay: number } =>
  account instanceof CreditCard && account.dueDay !== null;

@Injectable()
export class ListOpenCardInvoicesService implements Service<
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

  async execute({ workspaceId }: Request): Promise<Either<Error, Response>> {
    const [accounts, cycle, timezone] = await Promise.all([
      this.accountRepository.findAllByWorkspaceId(workspaceId),
      this.workspaceCycle.execute(workspaceId),
      this.workspaceTimezone.execute(workspaceId),
    ]);
    if (cycle === null) return left(new WorkspaceNotFoundError());

    const cards: CardWithCycle[] = accounts
      .filter(hasConfiguredCycle)
      .map((card) => ({
        card,
        calendar: new InvoiceCalendar({
          closingDaysBeforeDue: card.closingDaysBeforeDue,
          dueDay: card.dueDay,
        }),
      }));

    if (cards.length === 0) return right({ invoices: [] });

    const today = this.localTodayOf(timezone);
    const cycleWindow = CycleWindow.of(today, cycle);
    const bills = cards.map((entry) =>
      this.openBillOf(entry, today, cycleWindow),
    );
    const totals = await this.cardInvoiceRepository.findTotals(
      workspaceId,
      bills.flatMap(({ windows }) => windows),
    );
    const invoices = this.invoicesOf(bills, totals);

    return right({ invoices });
  }

  private openBillOf(
    { card, calendar }: CardWithCycle,
    today: PlainDate,
    cycleWindow: CycleWindow,
  ): OpenBillOfCard {
    const current = calendar.bounds(calendar.invoiceKeyFor(today));
    const candidate = openInvoiceOf(calendar, current, cycleWindow);
    const keys =
      candidate.key !== current.key
        ? [candidate.key, current.key]
        : [current.key];

    return {
      card,
      today,
      current,
      candidate,
      keys,
      windows: keys.map((key) =>
        cardInvoiceWindowOf(card, calendar, key, today),
      ),
    };
  }

  private invoicesOf(
    bills: OpenBillOfCard[],
    totals: CardInvoiceTotals[],
  ): OpenCardInvoice[] {
    let cursor = 0;

    return bills.map((bill) => {
      const billTotals = totals.slice(cursor, cursor + bill.windows.length);
      cursor += bill.windows.length;

      return this.invoiceOf({ ...bill, totals: billTotals });
    });
  }

  private invoiceOf(bill: BillWithTotals): OpenCardInvoice {
    const bounds = payableInvoiceOf(
      bill.current,
      bill.candidate,
      (key) => this.statementOf(bill, key).remaining,
    );
    const index = bill.keys.indexOf(bounds.key);
    const totals = bill.totals[index];
    const statement = buildInvoiceStatementFromTotals(totals);

    return {
      account: bill.card,
      key: bounds.key,
      totalAmount: statement.remaining,
      previousBalance: statement.previousBalance,
      statementTotal: statement.total,
      pendingAmount: totals.pendingCharges,
      dueDate: bounds.dueDate,
      periodStart: bounds.periodStart,
      periodEnd: bounds.periodEnd,
      invoiceStatus: invoiceStatusOf({
        statement,
        key: bounds.key,
        currentKey: bill.current.key,
        dueDate: bounds.dueDate,
        today: bill.today,
      }),
    };
  }

  private statementOf(bill: BillWithTotals, key: InvoiceKey): InvoiceStatement {
    return buildInvoiceStatementFromTotals(bill.totals[bill.keys.indexOf(key)]);
  }

  private localTodayOf(timezone: string): PlainDate {
    return this.dateProvider.format(
      this.dateProvider.now(),
      'YYYY-MM-DD',
      timezone,
    );
  }
}
