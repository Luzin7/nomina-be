import { RecurrenceFrequency, TransactionType } from '@constants/enums';
import * as schema from '@infra/databases/drizzle/schema';
import { RecurringTransaction } from '@modules/transaction/entities/RecurringTransaction';

type RecurringTransactionDrizzle =
  typeof schema.recurringTransactions.$inferSelect;
type RecurringTransactionDrizzleInsert =
  typeof schema.recurringTransactions.$inferInsert;

export class RecurringTransactionMapper {
  static toDomain(raw: RecurringTransactionDrizzle): RecurringTransaction {
    return RecurringTransaction.restore(
      {
        workspaceId: raw.workspaceId,
        accountId: raw.accountId,
        categoryId: raw.categoryId,
        destinationAccountId: raw.destinationAccountId ?? null,
        title: raw.title,
        description: raw.description ?? null,
        amount: BigInt(raw.amount),
        type: raw.type as TransactionType,
        frequency: raw.frequency as RecurrenceFrequency,
        interval: raw.interval,
        startDate: raw.startDate,
        endDate: raw.endDate ?? null,
        active: raw.active,
        lastGenerated: raw.lastGenerated ?? null,
      },
      raw.id,
    );
  }

  static toDatabase(
    entity: RecurringTransaction,
  ): RecurringTransactionDrizzleInsert {
    return {
      id: entity.id,
      workspaceId: entity.workspaceId,
      accountId: entity.accountId,
      categoryId: entity.categoryId,
      destinationAccountId: entity.destinationAccountId,
      title: entity.title,
      description: entity.description,
      amount: Number(entity.amount),
      type: entity.type,
      frequency: entity.frequency,
      interval: entity.interval,
      startDate: entity.startDate,
      endDate: entity.endDate,
      active: entity.active,
      lastGenerated: entity.lastGenerated,
    };
  }
}
