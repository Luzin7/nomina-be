import { RecurringSuggestionStatus } from '@constants/enums';
import { AggregateRoot } from '@shared/core/Entities/AggregateRoot';

export interface RecurringSuggestionProps {
  workspaceId: string;
  categoryId: string;
  accountId: string;
  suggestedTitle: string;
  amount: bigint;
  dayOfMonth: number;
  status: RecurringSuggestionStatus;
  recurringId: string | null;
  shownAt: Date | null;
  createdAt: Date;
  updatedAt: Date | null;
}

export class RecurringSuggestion extends AggregateRoot<RecurringSuggestionProps> {
  private constructor(props: RecurringSuggestionProps, id: string) {
    super(props, id);
  }

  static restore(
    props: RecurringSuggestionProps,
    id: string,
  ): RecurringSuggestion {
    return new RecurringSuggestion(props, id);
  }

  get workspaceId(): string {
    return this.props.workspaceId;
  }

  get categoryId(): string {
    return this.props.categoryId;
  }

  get accountId(): string {
    return this.props.accountId;
  }

  get suggestedTitle(): string {
    return this.props.suggestedTitle;
  }

  get amount(): bigint {
    return this.props.amount;
  }

  get dayOfMonth(): number {
    return this.props.dayOfMonth;
  }

  get status(): RecurringSuggestionStatus {
    return this.props.status;
  }

  get recurringId(): string | null {
    return this.props.recurringId;
  }

  get shownAt(): Date | null {
    return this.props.shownAt;
  }

  get createdAt(): Date {
    return this.props.createdAt;
  }

  get updatedAt(): Date | null {
    return this.props.updatedAt;
  }
}
