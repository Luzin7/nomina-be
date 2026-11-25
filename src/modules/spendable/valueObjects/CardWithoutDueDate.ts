export type CardWithoutDueDateInput = {
  accountId: string;
  name: string;
  limitCents: number | null;
};

const nonNegative = (value: number): number => Math.max(0, value);

export class CardWithoutDueDate {
  private constructor(private readonly record: CardWithoutDueDateInput) {}

  static of(input: CardWithoutDueDateInput): CardWithoutDueDate {
    return new CardWithoutDueDate({
      ...input,
      limitCents:
        input.limitCents === null ? null : nonNegative(input.limitCents),
    });
  }

  get accountId(): string {
    return this.record.accountId;
  }

  get name(): string {
    return this.record.name;
  }

  get limitCents(): number | null {
    return this.record.limitCents;
  }
}
