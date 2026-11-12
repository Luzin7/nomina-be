import { makeCreditCard } from '@modules/account/test-helpers/mock-factories';
import { findCardDueInWindow } from './CardDueWindow';

describe('findCardDueInWindow', () => {
  it('returns null for a card without a configured dueDay', () => {
    const card = makeCreditCard({ dueDay: null });

    expect(findCardDueInWindow(card, '2026-11-12')).toBeNull();
  });

  it('finds a card due within the window', () => {
    const card = makeCreditCard({ dueDay: 15 });

    expect(findCardDueInWindow(card, '2026-11-12')).toMatchObject({
      month: 11,
      days: 3,
    });
  });
});
