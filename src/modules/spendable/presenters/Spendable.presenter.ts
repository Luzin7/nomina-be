import type { WorkspaceCycle } from '@constants/enums';
import type { GetSpendableResult } from '../features/get-spendable/get-spendable.handler';
import type { SpendableState } from '../valueObjects/SpendableFigure';

export type SpendableCardPayload = {
  accountId: string;
  name: string;
  dueDate: string;
  limitCents: number;
  spendCents: number;
  headroomCents: number;
};

export type SpendableCardWithoutDueDatePayload = {
  accountId: string;
  name: string;
  limitCents: number | null;
};

export type SpendablePayload = {
  state: SpendableState;
  cycle: WorkspaceCycle;
  cycleStartDate: string;
  cycleEndDate: string;
  daysRemaining: number;
  cashCents: number;
  obligationsCents: number;
  cashFreeCents: number;
  incomeCents: number;
  cards: SpendableCardPayload[];
  cardsWithoutDueDate: SpendableCardWithoutDueDatePayload[];
  cardsHeadroomCents: number;
  spendableCents: number;
};

export class SpendablePresenter {
  static toHTTP({
    cycle,
    window,
    figure,
    cards,
    undatedCards,
  }: GetSpendableResult): SpendablePayload {
    return {
      state: figure.state,
      cycle,
      cycleStartDate: window.startDate,
      cycleEndDate: window.endDate,
      daysRemaining: window.daysRemaining,
      cashCents: figure.cashCents,
      obligationsCents: figure.obligationsCents,
      cashFreeCents: figure.cashFreeCents,
      incomeCents: figure.incomeCents,
      cards: cards.map((card) => ({
        accountId: card.accountId,
        name: card.name,
        dueDate: card.dueDate,
        limitCents: card.limitCents,
        spendCents: card.spendCents,
        headroomCents: card.headroomCents,
      })),
      cardsWithoutDueDate: undatedCards.map((card) => ({
        accountId: card.accountId,
        name: card.name,
        limitCents: card.limitCents,
      })),
      cardsHeadroomCents: figure.cardsHeadroomCents,
      spendableCents: figure.spendableCents,
    };
  }
}
