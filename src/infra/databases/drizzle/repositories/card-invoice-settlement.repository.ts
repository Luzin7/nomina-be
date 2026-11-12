import { AccountType } from '@constants/enums';
import { DrizzleService } from '@infra/databases/drizzle/drizzle.service';
import {
  AutopayCandidate,
  CardInvoiceSettlementRepository,
  ClaimInvoiceSettlementInput,
  InvoicePeriod,
  InvoiceSettlementClaim,
} from '@modules/transaction/repositories/contracts/CardInvoiceSettlementRepository';
import { Injectable } from '@nestjs/common';
import { and, asc, count, eq, gt, isNotNull, isNull } from 'drizzle-orm';
import * as schema from '../schema';

const autopayCandidateFilter = and(
  eq(schema.accounts.type, AccountType.CREDIT_CARD),
  eq(schema.accounts.autoPayEnabled, true),
  isNotNull(schema.accounts.autoPaySourceAccountId),
  isNotNull(schema.accounts.dueDay),
);

@Injectable()
export class CardInvoiceSettlementRepositoryImplementation implements CardInvoiceSettlementRepository {
  constructor(private readonly drizzle: DrizzleService) {}

  async findAutopayCandidates(
    afterAccountId: string | null,
    limit: number,
  ): Promise<AutopayCandidate[]> {
    const rows = await this.drizzle.db
      .select({
        cardAccountId: schema.accounts.id,
        workspaceId: schema.accounts.workspaceId,
        timezone: schema.accounts.timezone,
        dueDay: schema.accounts.dueDay,
        closingDaysBeforeDue: schema.accounts.closingDaysBeforeDue,
        sourceAccountId: schema.accounts.autoPaySourceAccountId,
      })
      .from(schema.accounts)
      .where(
        and(
          autopayCandidateFilter,
          afterAccountId ? gt(schema.accounts.id, afterAccountId) : undefined,
        ),
      )
      .orderBy(asc(schema.accounts.id))
      .limit(limit);

    return rows.map((row) => ({
      ...row,
      dueDay: row.dueDay as number,
      sourceAccountId: row.sourceAccountId as string,
    }));
  }

  async countAutopayCandidates(): Promise<number> {
    const [{ totalCount }] = await this.drizzle.db
      .select({ totalCount: count() })
      .from(schema.accounts)
      .where(autopayCandidateFilter);

    return totalCount;
  }

  async claim(input: ClaimInvoiceSettlementInput): Promise<string | null> {
    const [inserted] = await this.drizzle.db
      .insert(schema.cardInvoiceSettlements)
      .values({
        workspaceId: input.workspaceId,
        cardAccountId: input.cardAccountId,
        invoicePeriodMonth: input.month,
        invoicePeriodYear: input.year,
      })
      .onConflictDoNothing({
        target: [
          schema.cardInvoiceSettlements.cardAccountId,
          schema.cardInvoiceSettlements.invoicePeriodMonth,
          schema.cardInvoiceSettlements.invoicePeriodYear,
        ],
      })
      .returning({ id: schema.cardInvoiceSettlements.id });

    return inserted?.id ?? null;
  }

  async findClaim(
    cardAccountId: string,
    period: InvoicePeriod,
  ): Promise<InvoiceSettlementClaim | null> {
    const [row] = await this.drizzle.db
      .select({
        id: schema.cardInvoiceSettlements.id,
        transactionId: schema.cardInvoiceSettlements.transactionId,
        createdAt: schema.cardInvoiceSettlements.createdAt,
      })
      .from(schema.cardInvoiceSettlements)
      .where(
        and(
          eq(schema.cardInvoiceSettlements.cardAccountId, cardAccountId),
          eq(schema.cardInvoiceSettlements.invoicePeriodMonth, period.month),
          eq(schema.cardInvoiceSettlements.invoicePeriodYear, period.year),
        ),
      );

    return row ?? null;
  }

  async releaseClaim(claimId: string): Promise<void> {
    await this.drizzle.db
      .delete(schema.cardInvoiceSettlements)
      .where(
        and(
          eq(schema.cardInvoiceSettlements.id, claimId),
          isNull(schema.cardInvoiceSettlements.transactionId),
        ),
      );
  }

  async attachTransaction(
    claimId: string,
    transactionId: string,
  ): Promise<void> {
    await this.drizzle.db
      .update(schema.cardInvoiceSettlements)
      .set({ transactionId })
      .where(eq(schema.cardInvoiceSettlements.id, claimId));
  }
}
