import { CreditCard } from '@modules/account/entities/CreditCardAccount';
import { AccountRepository } from '@modules/account/repositories/contracts/AccountRepository';
import { CardInvoiceRepository } from '@modules/account/repositories/contracts/CardInvoiceRepository';
import { cardInvoiceWindowOf } from '@modules/account/valueObjects/CardInvoiceWindow';
import { InvoiceCalendar } from '@modules/account/valueObjects/InvoiceCalendar';
import {
  buildInvoiceStatementFromTotals,
  InvoiceStatus,
  invoiceStatusOf,
} from '@modules/account/valueObjects/InvoiceStatement';
import { Injectable } from '@nestjs/common';
import { DateProvider } from '@providers/date/contracts/DateProvider';
import { Service } from '@shared/core/contracts/Service';
import { Either, right } from '@shared/core/errors/Either';

type Request = { workspaceId: string };

export type OpenCardInvoice = {
  account: CreditCard;
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

const hasConfiguredCycle = (account: unknown): account is CreditCard =>
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
    private readonly dateProvider: DateProvider,
  ) {}

  async execute({ workspaceId }: Request): Promise<Either<Error, Response>> {
    const accounts =
      await this.accountRepository.findAllByWorkspaceId(workspaceId);
    const cards: CardWithCycle[] = accounts
      .filter(hasConfiguredCycle)
      .map((card) => ({
        card,
        calendar: new InvoiceCalendar({
          closingDaysBeforeDue: card.closingDaysBeforeDue,
          dueDay: card.dueDay as number,
        }),
      }));

    if (cards.length === 0) return right({ invoices: [] });

    const current = cards.map((entry) => this.currentInvoiceOf(entry));
    const totals = await this.cardInvoiceRepository.findTotals(
      workspaceId,
      current.map(({ window }) => window),
    );

    return right({
      invoices: cards.map(({ card }, index) => {
        const { key, today, bounds } = current[index];
        const statement = buildInvoiceStatementFromTotals(totals[index]);

        return {
          account: card,
          totalAmount: statement.remaining,
          previousBalance: statement.previousBalance,
          statementTotal: statement.total,
          pendingAmount: totals[index].pendingCharges,
          dueDate: bounds.dueDate,
          periodStart: bounds.periodStart,
          periodEnd: bounds.periodEnd,
          invoiceStatus: invoiceStatusOf({
            statement,
            key,
            currentKey: key,
            dueDate: bounds.dueDate,
            today,
          }),
        };
      }),
    });
  }

  private currentInvoiceOf({ card, calendar }: CardWithCycle) {
    const today = this.dateProvider.format(
      this.dateProvider.now(),
      'YYYY-MM-DD',
      card.timezone,
    );
    const key = calendar.invoiceKeyFor(today);

    return {
      key,
      today,
      bounds: calendar.bounds(key),
      window: cardInvoiceWindowOf(card, calendar, key, today),
    };
  }
}
