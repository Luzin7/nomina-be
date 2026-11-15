import { RecurrenceFrequency } from '@constants/enums';

export type FindCardRecurrencesInput = {
  workspaceId: string;
  accountId: string;
  from: Date;
  to: Date;
};

export type CardRecurrence = {
  id: string;
  categoryId: string | null;
  amount: number;
  frequency: RecurrenceFrequency;
  interval: number;
  startDate: Date;
  endDate: Date | null;
  lastGenerated: Date | null;
  materializedDates: Date[];
};

export abstract class CardRecurrenceRepository {
  abstract findCardRecurrences(
    input: FindCardRecurrencesInput,
  ): Promise<CardRecurrence[]>;
}
