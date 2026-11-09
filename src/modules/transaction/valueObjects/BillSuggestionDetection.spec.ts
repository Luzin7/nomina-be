import { RecurrenceFrequency } from '@constants/enums';
import { DayJsDateProvider } from '@providers/date/implementations/Dayjs';
import {
  ActiveBillRule,
  BillDetectionTransaction,
  billDetectionWindow,
  detectBillSuggestions,
  isBillDetectionDue,
} from './BillSuggestionDetection';

const MONTHS = ['2025-11', '2025-12', '2026-01'];

function makeRow(
  overrides: Partial<BillDetectionTransaction> = {},
): BillDetectionTransaction {
  return {
    id: 'tx-1',
    categoryId: 'cat-rent',
    categoryName: 'Moradia',
    accountId: 'acc-1',
    amount: 150000,
    day: 5,
    month: '2025-11',
    ...overrides,
  };
}

const monthlyRows = (
  daysPerMonth: number[],
  amounts: number[] = [150000, 150000, 150000],
): BillDetectionTransaction[] =>
  MONTHS.map((month, index) =>
    makeRow({
      id: `tx-${month}`,
      month,
      day: daysPerMonth[index],
      amount: amounts[index],
    }),
  );

describe('detectBillSuggestions', () => {
  const detect = (
    transactions: BillDetectionTransaction[],
    activeRules: ActiveBillRule[] = [],
  ) => detectBillSuggestions({ months: MONTHS, transactions, activeRules });

  const rule = (overrides: Partial<ActiveBillRule> = {}): ActiveBillRule => ({
    categoryId: 'cat-rent',
    amount: 150000,
    frequency: RecurrenceFrequency.MONTHLY,
    interval: 1,
    startDate: new Date('2025-01-05T00:00:00.000Z'),
    endDate: null,
    ...overrides,
  });

  it('suggests a bill paid in each of the three months', () => {
    const [suggestion] = detect(monthlyRows([4, 6, 5]));

    expect(suggestion).toMatchObject({
      categoryId: 'cat-rent',
      categoryName: 'Moradia',
      accountId: 'acc-1',
      suggestedTitle: 'Moradia',
      amount: 150000,
      dayOfMonth: 5,
    });
    expect(suggestion.transactionIds).toHaveLength(3);
  });

  it('does not suggest an irregular day of month', () => {
    expect(detect(monthlyRows([2, 15, 28]))).toEqual([]);
  });

  it('does not suggest an amount outside the similarity ratio', () => {
    expect(detect(monthlyRows([5, 5, 5], [100000, 200000, 400000]))).toEqual(
      [],
    );
  });

  it('does not suggest a category with more than two entries in a month', () => {
    const rows = [
      ...monthlyRows([4, 6, 5]),
      makeRow({ id: 'extra', month: '2025-12', day: 20, amount: 9000 }),
      makeRow({ id: 'extra-2', month: '2025-12', day: 21, amount: 9100 }),
    ];

    expect(detect(rows)).toEqual([]);
  });

  it('does not suggest a pattern covered by an active rule', () => {
    expect(detect(monthlyRows([4, 6, 5]), [rule()])).toEqual([]);
  });

  it('still suggests a pattern covered by a yearly rule', () => {
    const [suggestion] = detect(monthlyRows([4, 6, 5]), [
      rule({ frequency: RecurrenceFrequency.YEARLY }),
    ]);

    expect(suggestion.categoryId).toBe('cat-rent');
  });

  it('still suggests a pattern covered by a rule with interval above one', () => {
    const [suggestion] = detect(monthlyRows([4, 6, 5]), [
      rule({ interval: 2 }),
    ]);

    expect(suggestion.categoryId).toBe('cat-rent');
  });

  it('still suggests a pattern whose covering rule starts after it', () => {
    const [suggestion] = detect(monthlyRows([4, 6, 5]), [
      rule({ startDate: new Date('2026-02-05T00:00:00.000Z') }),
    ]);

    expect(suggestion.categoryId).toBe('cat-rent');
  });

  it('still suggests a pattern whose covering rule ended before it', () => {
    const [suggestion] = detect(monthlyRows([4, 6, 5]), [
      rule({ endDate: new Date('2026-01-04T00:00:00.000Z') }),
    ]);

    expect(suggestion.categoryId).toBe('cat-rent');
  });

  it('does not suggest a pattern whose covering rule ends after it', () => {
    expect(
      detect(monthlyRows([4, 6, 5]), [
        rule({ endDate: new Date('2026-01-05T00:00:00.000Z') }),
      ]),
    ).toEqual([]);
  });

  it('does not suggest without one occurrence in every month', () => {
    const rows = monthlyRows([5]).filter((row) => row.month !== '2025-12');

    expect(detect(rows)).toEqual([]);
  });

  it('uses the modal account and ties deterministically', () => {
    const rows = monthlyRows([4, 6, 5]).map((row, index) =>
      index === 2 ? { ...row, accountId: 'acc-2' } : row,
    );

    expect(detect(rows)[0].accountId).toBe('acc-1');
  });
});

describe('billDetectionWindow', () => {
  const dateProvider = new DayJsDateProvider();
  const timezone = 'America/Sao_Paulo';

  it('returns the three completed local months and their boundaries', () => {
    const window = billDetectionWindow(
      new Date('2026-02-10T15:00:00.000Z'),
      timezone,
      dateProvider,
    );

    expect(window.months).toEqual(['2025-11', '2025-12', '2026-01']);
    expect(window.from.toISOString()).toBe('2025-11-01T03:00:00.000Z');
    expect(window.to.toISOString()).toBe('2026-02-01T03:00:00.000Z');
  });
});

describe('isBillDetectionDue', () => {
  const timezone = 'America/Sao_Paulo';

  it('is due when detection never ran', () => {
    expect(
      isBillDetectionDue(null, new Date('2026-02-10T15:00:00.000Z'), timezone),
    ).toBe(true);
  });

  it('is not due when detection ran in the current local month', () => {
    expect(
      isBillDetectionDue(
        new Date('2026-02-03T12:00:00.000Z'),
        new Date('2026-02-10T15:00:00.000Z'),
        timezone,
      ),
    ).toBe(false);
  });

  it('is not due just before local midnight on the 1st of the next month', () => {
    expect(
      isBillDetectionDue(
        new Date('2026-01-15T12:00:00.000Z'),
        new Date('2026-02-01T02:59:59.000Z'),
        timezone,
      ),
    ).toBe(false);
  });

  it('is due just after local midnight on the 1st of the next month', () => {
    expect(
      isBillDetectionDue(
        new Date('2026-01-15T12:00:00.000Z'),
        new Date('2026-02-01T03:00:00.000Z'),
        timezone,
      ),
    ).toBe(true);
  });
});
