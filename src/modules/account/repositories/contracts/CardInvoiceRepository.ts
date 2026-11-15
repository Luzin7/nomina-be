import {
  CardInvoiceTotals,
  CardInvoiceWindow,
} from '@modules/account/valueObjects/CardInvoiceWindow';
import { Transaction } from '@modules/transaction/entities/Transaction';

export abstract class CardInvoiceRepository {
  abstract findTotals(
    workspaceId: string,
    windows: CardInvoiceWindow[],
  ): Promise<CardInvoiceTotals[]>;

  abstract findPeriodTransactions(
    workspaceId: string,
    window: CardInvoiceWindow,
  ): Promise<Transaction[]>;
}
