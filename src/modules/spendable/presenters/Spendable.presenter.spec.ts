import { CardHeadroom } from '../valueObjects/CardHeadroom';
import { CardWithoutDueDate } from '../valueObjects/CardWithoutDueDate';
import { CycleWindow } from '../valueObjects/CycleWindow';
import { SpendableFigure } from '../valueObjects/SpendableFigure';
import { SpendablePresenter } from './Spendable.presenter';

const RESULT = {
  cycle: 'monthly' as const,
  window: CycleWindow.of('2026-11-15', 'monthly'),
  figure: SpendableFigure.of({
    cashCents: 200000,
    obligationsCents: 50000,
    incomeCents: 677000,
    cards: [
      CardHeadroom.of({
        accountId: 'card-1',
        name: 'Nubank',
        dueDate: '2026-11-25',
        limitCents: 50000,
        spendCents: 10000,
      }),
    ],
  }),
  cards: [
    CardHeadroom.of({
      accountId: 'card-1',
      name: 'Nubank',
      dueDate: '2026-11-25',
      limitCents: 50000,
      spendCents: 10000,
    }),
  ],
  undatedCards: [
    CardWithoutDueDate.of({
      accountId: 'card-2',
      name: 'Visa',
      limitCents: 500000,
    }),
  ],
};

describe('SpendablePresenter', () => {
  it('serializes the figure, the window and the cards', () => {
    const payload = SpendablePresenter.toHTTP(RESULT);

    expect(payload).toEqual({
      state: 'normal',
      cycle: 'monthly',
      cycleStartDate: '2026-11-01',
      cycleEndDate: '2026-11-30',
      daysRemaining: 16,
      cashCents: 200000,
      obligationsCents: 50000,
      cashFreeCents: 150000,
      incomeCents: 677000,
      cards: [
        {
          accountId: 'card-1',
          name: 'Nubank',
          dueDate: '2026-11-25',
          limitCents: 50000,
          spendCents: 10000,
          headroomCents: 40000,
        },
      ],
      cardsWithoutDueDate: [
        { accountId: 'card-2', name: 'Visa', limitCents: 500000 },
      ],
      cardsHeadroomCents: 40000,
      spendableCents: 190000,
    });
  });

  it('keeps the cards empty when nothing is declared', () => {
    const payload = SpendablePresenter.toHTTP({
      ...RESULT,
      figure: SpendableFigure.of({
        cashCents: 0,
        obligationsCents: 0,
        incomeCents: 0,
        cards: [],
      }),
      cards: [],
      undatedCards: [],
    });

    expect(payload.cards).toEqual([]);
    expect(payload.cardsWithoutDueDate).toEqual([]);
    expect(payload.state).toBe('zero');
  });
});
