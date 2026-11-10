import { RecurringSuggestionStatus } from '@constants/enums';
import * as schema from '@infra/databases/drizzle/schema';
import { RecurringSuggestion } from '@modules/transaction/entities/RecurringSuggestion';

type RecurringSuggestionRow = typeof schema.recurringSuggestions.$inferSelect;

export class RecurringSuggestionMapper {
  static toDomain(raw: RecurringSuggestionRow): RecurringSuggestion {
    return RecurringSuggestion.restore(
      {
        workspaceId: raw.workspaceId,
        categoryId: raw.categoryId,
        accountId: raw.accountId,
        suggestedTitle: raw.suggestedTitle,
        amount: BigInt(raw.amount),
        dayOfMonth: raw.dayOfMonth,
        status: raw.status as RecurringSuggestionStatus,
        recurringId: raw.recurringId ?? null,
        shownAt: raw.shownAt ?? null,
        createdAt: raw.createdAt,
        updatedAt: raw.updatedAt ?? null,
      },
      raw.id,
    );
  }
}
