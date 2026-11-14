import { type IncomeBracketRow, resolveIncomeBracket } from './IncomeBracket';

const MINIMUM_WAGE = 162_100;

const ROWS: IncomeBracketRow[] = [
  {
    position: 1,
    maxMinimumWages: '2.00',
    essentialsBp: 7000,
    lifestyleBp: 2000,
    savingsBp: 1000,
  },
  {
    position: 2,
    maxMinimumWages: '5.00',
    essentialsBp: 6000,
    lifestyleBp: 2500,
    savingsBp: 1500,
  },
  {
    position: 3,
    maxMinimumWages: '10.00',
    essentialsBp: 5000,
    lifestyleBp: 3000,
    savingsBp: 2000,
  },
  {
    position: 4,
    maxMinimumWages: null,
    essentialsBp: 4500,
    lifestyleBp: 2500,
    savingsBp: 3000,
  },
];

const positionOf = (incomeCents: number, rows = ROWS): number | undefined =>
  resolveIncomeBracket({
    incomeCents,
    minimumWageCents: MINIMUM_WAGE,
    rows,
  })?.position;

describe('resolveIncomeBracket', () => {
  it.each([
    [MINIMUM_WAGE * 2, 1],
    [MINIMUM_WAGE * 2 + 1, 2],
    [MINIMUM_WAGE * 5, 2],
    [MINIMUM_WAGE * 5 + 1, 3],
    [MINIMUM_WAGE * 10, 3],
    [MINIMUM_WAGE * 10 + 1, 4],
    [1, 1],
  ])('maps income %i to bracket %i', (income, position) => {
    expect(positionOf(income)).toBe(position);
  });

  it('returns the shares of the matched bracket', () => {
    expect(
      resolveIncomeBracket({
        incomeCents: MINIMUM_WAGE * 3,
        minimumWageCents: MINIMUM_WAGE,
        rows: ROWS,
      }),
    ).toEqual({
      position: 2,
      shares: { essentials: 6000, lifestyle: 2500, savings: 1500 },
    });
  });

  it('is unavailable when the ladder has no open-ended last row', () => {
    expect(positionOf(100, ROWS.slice(0, 3))).toBeUndefined();
  });

  it('is unavailable when a position is missing', () => {
    expect(positionOf(100, [ROWS[0], ROWS[2], ROWS[3]])).toBeUndefined();
  });

  it('is unavailable without a minimum wage', () => {
    expect(
      resolveIncomeBracket({
        incomeCents: 100,
        minimumWageCents: 0,
        rows: ROWS,
      }),
    ).toBeNull();
  });
});
