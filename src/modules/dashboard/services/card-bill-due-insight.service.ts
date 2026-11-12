import { CreditCard } from '@modules/account/entities/CreditCardAccount';
import { GetCreditCardInvoiceService } from '@modules/account/features/get-credit-card-invoice/get-credit-card-invoice.handler';
import { ListAccountsService } from '@modules/account/features/list-accounts/list-accounts.service';
import { Injectable } from '@nestjs/common';
import { AccountScanTruncatedError } from '../errors';
import type { AvailableToSpendInsight } from '../valueObjects/AvailableToSpend';
import {
  findCardDueInWindow,
  type CardDueInWindow,
} from '../valueObjects/CardDueWindow';

const ACCOUNT_SCAN_PAGE_SIZE = 200;
const PT_BR = 'pt-BR';

type Request = { workspaceId: string; sub: string; today: string };

const byNearestThenName = (a: CardDueInWindow, b: CardDueInWindow): number =>
  a.days - b.days || a.card.name.localeCompare(b.card.name, PT_BR);

@Injectable()
export class CardBillDueInsightService {
  constructor(
    private readonly listAccounts: ListAccountsService,
    private readonly getCreditCardInvoice: GetCreditCardInvoiceService,
  ) {}

  async execute({
    workspaceId,
    sub,
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

    const payable = await Promise.all(
      due.map(async (entry) =>
        (await this.hasAmountDue(entry, { workspaceId, sub })) ? entry : null,
      ),
    );
    const [nearest] = payable
      .filter((entry): entry is CardDueInWindow => entry !== null)
      .sort(byNearestThenName);
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

  private async hasAmountDue(
    { card, month, year }: CardDueInWindow,
    identity: { workspaceId: string; sub: string },
  ): Promise<boolean> {
    const invoice = await this.getCreditCardInvoice.execute({
      ...identity,
      accountId: card.id,
      month,
      year,
    });
    if (invoice.isLeft()) throw invoice.value;

    return (
      invoice.value.invoiceStatus !== 'paid' && invoice.value.totalAmount > 0n
    );
  }
}
