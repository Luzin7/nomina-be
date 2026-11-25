import type { PlainDate } from '@modules/account/valueObjects/InvoiceCalendar';

export type CardHeadroomInput = {
  accountId: string;
  name: string;
  dueDate: PlainDate;
  limitCents: number;
  spendCents: number;
};

export type CardHeadroomRecord = CardHeadroomInput & {
  headroomCents: number;
};

const nonNegative = (value: number): number => Math.max(0, value);

export class CardHeadroom {
  private constructor(private readonly record: CardHeadroomRecord) {}

  static of(input: CardHeadroomInput): CardHeadroom {
    const limitCents = nonNegative(input.limitCents);
    const spendCents = nonNegative(input.spendCents);

    return new CardHeadroom({
      ...input,
      limitCents,
      spendCents,
      headroomCents: nonNegative(limitCents - spendCents),
    });
  }

  get accountId(): string {
    return this.record.accountId;
  }

  get name(): string {
    return this.record.name;
  }

  get dueDate(): PlainDate {
    return this.record.dueDate;
  }

  get limitCents(): number {
    return this.record.limitCents;
  }

  get spendCents(): number {
    return this.record.spendCents;
  }

  get headroomCents(): number {
    return this.record.headroomCents;
  }
}
