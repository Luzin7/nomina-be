import { detectFixedBills, sumFixedBillsDue } from './FixedBills';
import { LedgerMonth, PlainExpense } from './ProjectionRules';

const makeRow = (overrides: Partial<PlainExpense> = {}): PlainExpense => ({
  day: 2,
  categoryId: 'luz',
  amount: 22000,
  pending: false,
  ...overrides,
});

const makeMonth = (
  key: string,
  plainExpenses: PlainExpense[] = [],
): LedgerMonth => ({
  key,
  totalExpense: 0,
  pending: { totalIncome: 0, totalExpense: 0 },
  plainExpenses,
});

const SEPTEMBER = '2026-09';
const AUGUST = '2026-08';
const JULY = '2026-07';

const ALUGUEL_ROW = makeRow({ categoryId: 'aluguel', amount: 150000 });

const LUZ_BILL = { categoryId: 'luz', amount: 22000 };
const ALUGUEL_BILL = { categoryId: 'aluguel', amount: 150000 };

describe('detectFixedBills', () => {
  it('detects nothing without basis months', () => {
    expect(detectFixedBills([])).toEqual([]);
  });

  it('detects a bill present in the three months with the median amount', () => {
    const bills = detectFixedBills([
      makeMonth(SEPTEMBER, [makeRow({ amount: 20000 })]),
      makeMonth(AUGUST, [makeRow({ amount: 24000 })]),
      makeMonth(JULY, [makeRow({ amount: 22000 })]),
    ]);

    expect(bills).toEqual([{ categoryId: 'luz', amount: 22000 }]);
  });

  it('detects a bill with a single match and averages the two amounts', () => {
    const bills = detectFixedBills([
      makeMonth(SEPTEMBER, [makeRow({ amount: 21000 })]),
      makeMonth(AUGUST, [makeRow({ amount: 23000 })]),
      makeMonth(JULY),
    ]);

    expect(bills).toEqual([{ categoryId: 'luz', amount: 22000 }]);
  });

  it('rounds an odd-cent median to an integer bill amount', () => {
    const bills = detectFixedBills([
      makeMonth(SEPTEMBER, [makeRow({ amount: 10001 })]),
      makeMonth(AUGUST, [makeRow({ amount: 10000 })]),
      makeMonth(JULY),
    ]);

    expect(bills).toEqual([{ categoryId: 'luz', amount: 10001 }]);
    expect(sumFixedBillsDue(bills, [])).toBe(10001);
  });

  it('ignores the title and matches by category and amount only', () => {
    const bills = detectFixedBills([
      makeMonth(SEPTEMBER, [makeRow({ amount: 21000 })]),
      makeMonth(AUGUST, [makeRow({ amount: 21500 })]),
      makeMonth(JULY, [makeRow({ amount: 22000 })]),
    ]);

    expect(bills).toHaveLength(1);
  });

  it('does not project a bill missing from the newest month', () => {
    const bills = detectFixedBills([
      makeMonth(SEPTEMBER, [ALUGUEL_ROW]),
      makeMonth(AUGUST, [makeRow(), ALUGUEL_ROW]),
      makeMonth(JULY, [makeRow(), ALUGUEL_ROW]),
    ]);

    expect(bills).toEqual([ALUGUEL_BILL]);
  });

  it('detects no bill in a category with five rows a month', () => {
    const fiveRows = [1, 2, 3, 4, 5].map((day) =>
      makeRow({ categoryId: 'mercado', day, amount: 8000 }),
    );

    const bills = detectFixedBills([
      makeMonth(SEPTEMBER, [...fiveRows, ALUGUEL_ROW]),
      makeMonth(AUGUST, [...fiveRows, ALUGUEL_ROW]),
      makeMonth(JULY, [...fiveRows, ALUGUEL_ROW]),
    ]);

    expect(bills).toEqual([ALUGUEL_BILL]);
  });

  it('detects no bill when the amounts are not similar', () => {
    const bills = detectFixedBills([
      makeMonth(SEPTEMBER, [
        makeRow({ categoryId: 'saude', amount: 8000 }),
        ALUGUEL_ROW,
      ]),
      makeMonth(AUGUST, [
        makeRow({ categoryId: 'saude', amount: 60000 }),
        ALUGUEL_ROW,
      ]),
      makeMonth(JULY, [
        makeRow({ categoryId: 'saude', amount: 60000 }),
        ALUGUEL_ROW,
      ]),
    ]);

    expect(bills).toEqual([ALUGUEL_BILL]);
  });

  it('detects no bill across different categories with the same amount', () => {
    const bills = detectFixedBills([
      makeMonth(SEPTEMBER, [makeRow({ categoryId: 'luz' }), ALUGUEL_ROW]),
      makeMonth(AUGUST, [makeRow({ categoryId: 'agua' }), ALUGUEL_ROW]),
      makeMonth(JULY, [makeRow({ categoryId: 'internet' }), ALUGUEL_ROW]),
    ]);

    expect(bills).toEqual([ALUGUEL_BILL]);
  });

  it('detects one bill when the newest month paid it twice', () => {
    const bills = detectFixedBills([
      makeMonth(SEPTEMBER, [makeRow(), makeRow({ day: 3 })]),
      makeMonth(AUGUST, [makeRow()]),
      makeMonth(JULY, [makeRow()]),
    ]);

    expect(bills).toHaveLength(1);
  });

  it('ignores pending rows in the basis', () => {
    const bills = detectFixedBills([
      makeMonth(SEPTEMBER, [makeRow({ pending: true }), ALUGUEL_ROW]),
      makeMonth(AUGUST, [makeRow(), ALUGUEL_ROW]),
      makeMonth(JULY, [makeRow(), ALUGUEL_ROW]),
    ]);

    expect(bills).toEqual([ALUGUEL_BILL]);
  });

  it('detects two bills in different categories', () => {
    const bills = detectFixedBills([
      makeMonth(SEPTEMBER, [
        makeRow(),
        makeRow({ categoryId: 'aluguel', amount: 150000 }),
      ]),
      makeMonth(AUGUST, [
        makeRow(),
        makeRow({ categoryId: 'aluguel', amount: 150000 }),
      ]),
      makeMonth(JULY, [
        makeRow(),
        makeRow({ categoryId: 'aluguel', amount: 150000 }),
      ]),
    ]);

    expect(bills).toHaveLength(2);
  });
});

describe('sumFixedBillsDue', () => {
  it('returns zero without bills', () => {
    expect(sumFixedBillsDue([], [])).toBe(0);
  });

  it('adds the usual amount of a bill not paid yet', () => {
    expect(sumFixedBillsDue([LUZ_BILL], [])).toBe(22000);
  });

  it('adds every bill on the first day of the month', () => {
    expect(sumFixedBillsDue([LUZ_BILL, ALUGUEL_BILL], [])).toBe(172000);
  });

  it('adds only the bill still unpaid', () => {
    const paidAluguel = makeRow({ categoryId: 'aluguel', amount: 150000 });

    expect(sumFixedBillsDue([LUZ_BILL, ALUGUEL_BILL], [paidAluguel])).toBe(
      22000,
    );
  });

  it('adds nothing for a bill paid with a similar amount', () => {
    expect(
      sumFixedBillsDue([LUZ_BILL, ALUGUEL_BILL], [makeRow({ amount: 25000 })]),
    ).toBe(150000);
  });

  it('adds nothing for a pending row because it is already scheduled', () => {
    expect(
      sumFixedBillsDue([LUZ_BILL, ALUGUEL_BILL], [makeRow({ pending: true })]),
    ).toBe(150000);
  });

  it('adds the bill when the current row has a dissimilar amount', () => {
    expect(sumFixedBillsDue([LUZ_BILL], [makeRow({ amount: 3000 })])).toBe(
      22000,
    );
  });

  it('adds the bill when the current row has another category', () => {
    expect(
      sumFixedBillsDue([LUZ_BILL], [makeRow({ categoryId: 'agua' })]),
    ).toBe(22000);
  });

  it('adds nothing when the bill was paid twice in the month', () => {
    expect(
      sumFixedBillsDue(
        [LUZ_BILL, ALUGUEL_BILL],
        [makeRow(), makeRow({ day: 3 })],
      ),
    ).toBe(150000);
  });

  it('matches each current row to a single bill', () => {
    expect(sumFixedBillsDue([LUZ_BILL, LUZ_BILL], [makeRow()])).toBe(22000);
  });
});
