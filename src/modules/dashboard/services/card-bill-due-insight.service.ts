import { CreditCard } from '@modules/account/entities/CreditCardAccount';
import { ListAccountsService } from '@modules/account/features/list-accounts/list-accounts.service';
import { CardInvoiceRepository } from '@modules/account/repositories/contracts/CardInvoiceRepository';
import { cardInvoiceWindowOf } from '@modules/account/valueObjects/CardInvoiceWindow';
import { InvoiceCalendar } from '@modules/account/valueObjects/InvoiceCalendar';
import { buildInvoiceStatementFromTotals } from '@modules/account/valueObjects/InvoiceStatement';
import { Injectable } from '@nestjs/common';
import { DateProvider } from '@providers/date/contracts/DateProvider';
import { AccountScanTruncatedError } from '../errors';
import type { AvailableToSpendInsight } from '../valueObjects/AvailableToSpend';
import {
  findCardDueInWindow,
  type CardDueInWindow,
} from '../valueObjects/CardDueWindow';

const ACCOUNT_SCAN_PAGE_SIZE = 200;
const PT_BR = 'pt-BR';

type Request = { workspaceId: string; sub: string; today: string };

const invoiceKeyOf = ({ year, month }: CardDueInWindow): string =>
  `${year}-${String(month).padStart(2, '0')}`;

const byNearestThenName = (a: CardDueInWindow, b: CardDueInWindow): number =>
  a.days - b.days || a.card.name.localeCompare(b.card.name, PT_BR);

@Injectable()
export class CardBillDueInsightService {
  constructor(
    private readonly listAccounts: ListAccountsService,
    private readonly cardInvoiceRepository: CardInvoiceRepository,
    private readonly dateProvider: DateProvider,
  ) {}

  async execute({
    workspaceId,
    today,
  }: Request): Promise<AvailableToSpendInsight | null> {
    const listed = await this.listAccounts.execute({
      page: 1,
      pageSize: ACCOUNT_SCAN_PAGE_SIZE,
      workspaceId,
    });
    if (listed.isLeft()) throw listed.value;

    if (listed.value.total > listed.value.accounts.length) {
      throw new AccountScanTruncatedError();
    }

    const due = listed.value.accounts
      .map(({ account }) => account)
      .filter((account): account is CreditCard => account instanceof CreditCard)
      .map((card) => findCardDueInWindow(card, today))
      .filter((entry): entry is CardDueInWindow => entry !== null);

    if (due.length === 0) return null;

    const totals = await this.cardInvoiceRepository.findTotals(
      workspaceId,
      due.map((entry) =>
        cardInvoiceWindowOf(
          entry.card,
          new InvoiceCalendar({
            closingDaysBeforeDue: entry.card.closingDaysBeforeDue,
            dueDay: entry.card.dueDay as number,
          }),
          invoiceKeyOf(entry),
          this.todayOf(entry.card),
        ),
      ),
    );
    const payable = due.filter(
      (_entry, index) =>
        buildInvoiceStatementFromTotals(totals[index]).remaining > 0n,
    );
    const [nearest] = payable.sort(byNearestThenName);
    if (!nearest) return null;

    return {
      code: 'CARD_BILL_DUE',
      severity: 'high',
      args: {
        cardId: nearest.card.id,
        cardName: nearest.card.name,
        days: nearest.days,
      },
      href: `/accounts?card=${nearest.card.id}`,
    };
  }

  private todayOf(card: CreditCard): string {
    return this.dateProvider.format(
      this.dateProvider.now(),
      'YYYY-MM-DD',
      card.timezone,
    );
  }
}
