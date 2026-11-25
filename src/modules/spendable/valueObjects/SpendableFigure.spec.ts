import { CardHeadroom } from './CardHeadroom';
import { SpendableFigure } from './SpendableFigure';

const card = (headroomCents: number): CardHeadroom =>
  CardHeadroom.of({
    accountId: `card-${headroomCents}`,
    name: 'Card',
    dueDate: '2026-11-25',
    limitCents: headroomCents,
    spendCents: 0,
  });

describe('SpendableFigure', () => {
  it('sums the free cash with every card headroom', () => {
    const figure = SpendableFigure.of({
      cashCents: 63085,
      obligationsCents: 10000,
      incomeCents: 677000,
      cards: [card(30000), card(30000)],
    });

    expect(figure.cashFreeCents).toBe(53085);
    expect(figure.cardsHeadroomCents).toBe(60000);
    expect(figure.spendableCents).toBe(113085);
    expect(figure.state).toBe('normal');
  });

  it('floors the free cash at zero without lending the negative to the cards', () => {
    const figure = SpendableFigure.of({
      cashCents: -51615,
      obligationsCents: 0,
      incomeCents: 0,
      cards: [card(50000)],
    });

    expect(figure.cashFreeCents).toBe(0);
    expect(figure.spendableCents).toBe(50000);
    expect(figure.state).toBe('negative_cash');
  });

  it('floors the obligations at zero', () => {
    const figure = SpendableFigure.of({
      cashCents: 10000,
      obligationsCents: -500,
      incomeCents: 0,
      cards: [],
    });

    expect(figure.obligationsCents).toBe(0);
    expect(figure.cashFreeCents).toBe(10000);
  });

  it('reads obligations above cash as its own state', () => {
    const figure = SpendableFigure.of({
      cashCents: 10000,
      obligationsCents: 15000,
      incomeCents: 50000,
      cards: [],
    });

    expect(figure.cashFreeCents).toBe(0);
    expect(figure.spendableCents).toBe(0);
    expect(figure.state).toBe('obligations_above_cash');
  });

  it('reads an empty workspace as zero', () => {
    const figure = SpendableFigure.of({
      cashCents: 0,
      obligationsCents: 0,
      incomeCents: 0,
      cards: [],
    });

    expect(figure.spendableCents).toBe(0);
    expect(figure.state).toBe('zero');
  });

  it('reads nothing subtracted with income', () => {
    const figure = SpendableFigure.of({
      cashCents: 50000,
      obligationsCents: 0,
      incomeCents: 677000,
      cards: [],
    });

    expect(figure.state).toBe('nothing_scheduled');
  });

  it('reads a bare balance without income or declarations', () => {
    const figure = SpendableFigure.of({
      cashCents: 50000,
      obligationsCents: 0,
      incomeCents: 0,
      cards: [],
    });

    expect(figure.state).toBe('balance_only');
  });

  it('reads a card-only spendable as cards only', () => {
    const figure = SpendableFigure.of({
      cashCents: 0,
      obligationsCents: 0,
      incomeCents: 0,
      cards: [card(50000)],
    });

    expect(figure.cashFreeCents).toBe(0);
    expect(figure.state).toBe('cards_only');
  });
});
