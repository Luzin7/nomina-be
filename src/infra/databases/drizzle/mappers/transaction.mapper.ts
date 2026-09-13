import { TransactionStatus, TransactionType } from '@constants/enums';
import * as schema from '@infra/databases/drizzle/schema';
import { Transaction } from '@modules/transaction/entities/Transaction';

type TransactionDrizzle = typeof schema.transactions.$inferSelect;
type TransactionDrizzleInsert = typeof schema.transactions.$inferInsert;

export class TransactionMapper {
  static toDomain(raw: TransactionDrizzle): Transaction {
    return Transaction.restore(
      {
        workspaceId: raw.workspaceId,
        accountId: raw.accountId,
        categoryId: raw.categoryId,
        destinationAccountId: raw.destinationAccountId ?? null,
        title: raw.title,
        description: raw.description ?? null,
        amount: BigInt(raw.amount),
        date: raw.date,
        type: raw.type as TransactionType,
        status: raw.status as TransactionStatus,
        recurringId: raw.recurringId ?? null,
        installmentGroupId: raw.installmentGroupId ?? null,
        installmentNumber: raw.installmentNumber ?? null,
        installmentCount: raw.installmentCount ?? null,
        invoicePeriodMonth: raw.invoicePeriodMonth ?? null,
        invoicePeriodYear: raw.invoicePeriodYear ?? null,
        createdAt: raw.createdAt,
        updatedAt: raw.updatedAt ?? null,
      },
      raw.id,
    );
  }

  static toDatabase(entity: Transaction): TransactionDrizzleInsert {
    return {
      id: entity.id,
      workspaceId: entity.workspaceId,
      accountId: entity.accountId,
      categoryId: entity.categoryId,
      destinationAccountId: entity.destinationAccountId,
      title: entity.title,
      description: entity.description,
      amount: Number(entity.amount),
      date: entity.date,
      type: entity.type,
      status: entity.status,
      recurringId: entity.recurringId,
      installmentGroupId: entity.installmentGroupId,
      installmentNumber: entity.installmentNumber,
      installmentCount: entity.installmentCount,
      invoicePeriodMonth: entity.invoicePeriodMonth,
      invoicePeriodYear: entity.invoicePeriodYear,
      createdAt: entity.createdAt,
      updatedAt: entity.updatedAt ?? null,
    };
  }
}
