import { CardHeadroom } from './CardHeadroom';

const INPUT = {
  accountId: 'card-1',
  name: 'Nubank',
  dueDate: '2026-11-25',
  limitCents: 50000,
  spendCents: 10000,
};

describe('CardHeadroom', () => {
  it('subtracts the invoice spend from the declared limit', () => {
    const headroom = CardHeadroom.of(INPUT);

    expect(headroom.headroomCents).toBe(40000);
  });

  it('floors the headroom at zero when the spend passes the limit', () => {
    const headroom = CardHeadroom.of({ ...INPUT, spendCents: 80000 });

    expect(headroom.headroomCents).toBe(0);
  });

  it('floors the limit and the spend at zero', () => {
    const headroom = CardHeadroom.of({
      ...INPUT,
      limitCents: -5000,
      spendCents: -3000,
    });

    expect(headroom.limitCents).toBe(0);
    expect(headroom.spendCents).toBe(0);
    expect(headroom.headroomCents).toBe(0);
  });

  it('keeps the card identity and the invoice due date', () => {
    const headroom = CardHeadroom.of(INPUT);

    expect(headroom.accountId).toBe('card-1');
    expect(headroom.name).toBe('Nubank');
    expect(headroom.dueDate).toBe('2026-11-25');
  });
});
