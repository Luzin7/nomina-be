import { RecurrenceFrequency, TransactionType } from '@constants/enums';
import { DrizzleService } from '@infra/databases/drizzle/drizzle.service';
import {
  CardRecurrence,
  CardRecurrenceRepository,
  FindCardRecurrencesInput,
} from '@modules/account/repositories/contracts/CardRecurrenceRepository';
import { Injectable } from '@nestjs/common';
import { and, asc, eq, gte, inArray, isNull, lt, or } from 'drizzle-orm';
import * as schema from '../schema';

const recurringTransactions = schema.recurringTransactions;
const transactions = schema.transactions;

@Injectable()
export class CardRecurrenceRepositoryImplementation implements CardRecurrenceRepository {
  constructor(private readonly drizzle: DrizzleService) {}

  async findCardRecurrences(
    input: FindCardRecurrencesInput,
  ): Promise<CardRecurrence[]> {
    const rules = await this.drizzle.db
      .select()
      .from(recurringTransactions)
      .where(
        and(
          eq(recurringTransactions.workspaceId, input.workspaceId),
          eq(recurringTransactions.accountId, input.accountId),
          eq(recurringTransactions.type, TransactionType.EXPENSE),
          eq(recurringTransactions.active, true),
          isNull(recurringTransactions.destinationAccountId),
          or(
            isNull(recurringTransactions.endDate),
            gte(recurringTransactions.endDate, input.from),
          ),
        ),
      )
      .orderBy(
        asc(recurringTransactions.startDate),
        asc(recurringTransactions.id),
      );

    if (rules.length === 0) return [];

    const materialized = await this.drizzle.db
      .select({
        recurringId: transactions.recurringId,
        date: transactions.date,
      })
      .from(transactions)
      .where(
        and(
          eq(transactions.workspaceId, input.workspaceId),
          inArray(
            transactions.recurringId,
            rules.map((rule) => rule.id),
          ),
          gte(transactions.date, input.from),
          lt(transactions.date, input.to),
        ),
      )
      .orderBy(asc(transactions.date));

    return rules.map((rule) => ({
      id: rule.id,
      categoryId: rule.categoryId,
      amount: rule.amount,
      frequency: rule.frequency as RecurrenceFrequency,
      interval: rule.interval,
      startDate: rule.startDate,
      endDate: rule.endDate,
      lastGenerated: rule.lastGenerated,
      materializedDates: materialized
        .filter((row) => row.recurringId === rule.id)
        .map((row) => row.date),
    }));
  }
}
