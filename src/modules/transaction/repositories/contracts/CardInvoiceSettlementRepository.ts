export interface AutopayCandidate {
  cardAccountId: string;
  workspaceId: string;
  timezone: string;
  dueDay: number;
  closingDaysBeforeDue: number;
  sourceAccountId: string;
}

export interface InvoicePeriod {
  month: number;
  year: number;
}

export interface ClaimInvoiceSettlementInput extends InvoicePeriod {
  workspaceId: string;
  cardAccountId: string;
}

export interface InvoiceSettlementClaim {
  id: string;
  transactionId: string | null;
  createdAt: Date;
}

export abstract class CardInvoiceSettlementRepository {
  abstract findAutopayCandidates(
    afterAccountId: string | null,
    limit: number,
  ): Promise<AutopayCandidate[]>;

  abstract countAutopayCandidates(): Promise<number>;

  abstract claim(input: ClaimInvoiceSettlementInput): Promise<string | null>;

  abstract findClaim(
    cardAccountId: string,
    period: InvoicePeriod,
  ): Promise<InvoiceSettlementClaim | null>;

  abstract releaseClaim(claimId: string): Promise<void>;

  abstract attachTransaction(
    claimId: string,
    transactionId: string,
  ): Promise<void>;
}
