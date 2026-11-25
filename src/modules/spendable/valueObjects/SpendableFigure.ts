import { CardHeadroom } from './CardHeadroom';

export const SPENDABLE_STATES = [
  'normal',
  'nothing_scheduled',
  'balance_only',
  'cards_only',
  'zero',
  'negative_cash',
  'obligations_above_cash',
] as const;

export type SpendableState = (typeof SPENDABLE_STATES)[number];

export type SpendableFigureInput = {
  cashCents: number;
  obligationsCents: number;
  incomeCents: number;
  cards: CardHeadroom[];
};

export type SpendableFigureRecord = {
  cashCents: number;
  obligationsCents: number;
  cashFreeCents: number;
  incomeCents: number;
  cardsHeadroomCents: number;
  spendableCents: number;
  state: SpendableState;
};

type StateInput = {
  cashCents: number;
  obligationsCents: number;
  cashFreeCents: number;
  incomeCents: number;
  spendableCents: number;
  cardCount: number;
};

const nonNegative = (value: number): number => Math.max(0, value);

const sumHeadroom = (cards: CardHeadroom[]): number =>
  cards.reduce((total, card) => total + card.headroomCents, 0);

const stateOf = ({
  cashCents,
  obligationsCents,
  cashFreeCents,
  incomeCents,
  spendableCents,
  cardCount,
}: StateInput): SpendableState => {
  if (cashCents < 0) return 'negative_cash';
  if (obligationsCents > cashCents) return 'obligations_above_cash';
  if (spendableCents === 0) return 'zero';
  if (cashFreeCents === 0) return 'cards_only';
  if (obligationsCents === 0 && incomeCents === 0 && cardCount === 0)
    return 'balance_only';
  if (obligationsCents === 0) return 'nothing_scheduled';
  return 'normal';
};

export class SpendableFigure {
  private constructor(private readonly record: SpendableFigureRecord) {}

  static of(input: SpendableFigureInput): SpendableFigure {
    const obligationsCents = nonNegative(input.obligationsCents);
    const incomeCents = nonNegative(input.incomeCents);
    const cashFreeCents = nonNegative(input.cashCents - obligationsCents);
    const cardsHeadroomCents = sumHeadroom(input.cards);
    const spendableCents = cashFreeCents + cardsHeadroomCents;

    return new SpendableFigure({
      cashCents: input.cashCents,
      obligationsCents,
      cashFreeCents,
      incomeCents,
      cardsHeadroomCents,
      spendableCents,
      state: stateOf({
        cashCents: input.cashCents,
        obligationsCents,
        cashFreeCents,
        incomeCents,
        spendableCents,
        cardCount: input.cards.length,
      }),
    });
  }

  get cashCents(): number {
    return this.record.cashCents;
  }

  get obligationsCents(): number {
    return this.record.obligationsCents;
  }

  get cashFreeCents(): number {
    return this.record.cashFreeCents;
  }

  get incomeCents(): number {
    return this.record.incomeCents;
  }

  get cardsHeadroomCents(): number {
    return this.record.cardsHeadroomCents;
  }

  get spendableCents(): number {
    return this.record.spendableCents;
  }

  get state(): SpendableState {
    return this.record.state;
  }
}
