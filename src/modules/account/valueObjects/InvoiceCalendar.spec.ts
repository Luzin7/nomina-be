import { InvoiceCalendar, InvoiceKey, PlainDate } from './InvoiceCalendar';

const addDays = (date: PlainDate, days: number): PlainDate => {
  const [year, month, day] = date.split('-').map(Number);
  const next = new Date(Date.UTC(year, month - 1, day + days));
  return `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, '0')}-${String(
    next.getUTCDate(),
  ).padStart(2, '0')}`;
};

const monthKey = (year: number, month: number): InvoiceKey =>
  `${year}-${String(month).padStart(2, '0')}`;

const previousKey = (key: InvoiceKey): InvoiceKey => {
  const [year, month] = key.split('-').map(Number);
  const index = year * 12 + (month - 1) - 1;
  return monthKey(Math.floor(index / 12), (index % 12) + 1);
};

const allDates = (start: PlainDate, end: PlainDate): PlainDate[] => {
  const dates: PlainDate[] = [];
  let cursor = start;
  while (cursor <= end) {
    dates.push(cursor);
    cursor = addDays(cursor, 1);
  }
  return dates;
};

describe('InvoiceCalendar', () => {
  describe('construction', () => {
    it.each([0, 29, 32, 1.5, Number.NaN])('rejects dueDay %p', (dueDay) => {
      expect(
        () => new InvoiceCalendar({ dueDay, closingDaysBeforeDue: 5 }),
      ).toThrow();
    });

    it.each([0, 1, 6, 8, 9, 11, 32])(
      'rejects closingDaysBeforeDue %p',
      (closingDaysBeforeDue) => {
        expect(
          () => new InvoiceCalendar({ dueDay: 5, closingDaysBeforeDue }),
        ).toThrow();
      },
    );

    it.each([5, 7, 10])(
      'accepts closingDaysBeforeDue %d',
      (closingDaysBeforeDue) => {
        expect(
          () => new InvoiceCalendar({ dueDay: 5, closingDaysBeforeDue }),
        ).not.toThrow();
      },
    );
  });

  describe('due day is fixed and closing is derived', () => {
    const calendar = new InvoiceCalendar({
      dueDay: 5,
      closingDaysBeforeDue: 5,
    });

    it('derives the period from the previous closing', () => {
      expect(calendar.bounds('2026-09')).toEqual({
        key: '2026-09',
        periodStart: '2026-08-01',
        periodEnd: '2026-08-31',
        endExclusive: '2026-09-01',
        dueDate: '2026-09-05',
      });
      expect(calendar.bounds('2026-10')).toEqual({
        key: '2026-10',
        periodStart: '2026-09-01',
        periodEnd: '2026-09-30',
        endExclusive: '2026-10-01',
        dueDate: '2026-10-05',
      });
    });

    it('assigns the closing day to the invoice that closes', () => {
      expect(calendar.invoiceKeyFor('2026-08-31')).toBe('2026-09');
      expect(calendar.invoiceKeyFor('2026-09-01')).toBe('2026-10');
      expect(calendar.invoiceKeyFor('2026-09-30')).toBe('2026-10');
    });
  });

  describe('due day 7 with 7 days before due', () => {
    const calendar = new InvoiceCalendar({
      dueDay: 7,
      closingDaysBeforeDue: 7,
    });

    it('closes on the last day of the previous month', () => {
      expect(calendar.bounds('2026-10')).toEqual({
        key: '2026-10',
        periodStart: '2026-09-01',
        periodEnd: '2026-09-30',
        endExclusive: '2026-10-01',
        dueDate: '2026-10-07',
      });
      expect(calendar.bounds('2026-11').periodEnd).toBe('2026-10-31');
    });
  });

  describe('february and month-length boundaries', () => {
    it('derives the closing for a February due date', () => {
      const calendar = new InvoiceCalendar({
        dueDay: 28,
        closingDaysBeforeDue: 10,
      });
      expect(calendar.bounds('2026-02').periodEnd).toBe('2026-02-18');
      expect(calendar.bounds('2026-02').dueDate).toBe('2026-02-28');
    });

    it('does not leak a day when the closing crosses into the previous month', () => {
      const calendar = new InvoiceCalendar({
        dueDay: 5,
        closingDaysBeforeDue: 5,
      });
      expect(calendar.bounds('2026-09').periodEnd).toBe('2026-08-31');
      expect(calendar.bounds('2026-09').periodStart).toBe('2026-08-01');
    });
  });

  describe('invariants (exhaustive)', () => {
    const dueDays = [1, 5, 7, 8, 15, 28];
    const closings = [5, 7, 10];
    const dates = allDates('2025-01-01', '2026-12-31');

    it('partitions every date into exactly one invoice', () => {
      for (const dueDay of dueDays) {
        for (const closingDaysBeforeDue of closings) {
          const calendar = new InvoiceCalendar({
            dueDay,
            closingDaysBeforeDue,
          });

          for (const date of dates) {
            const key = calendar.invoiceKeyFor(date);
            const bounds = calendar.bounds(key);

            expect(bounds.periodStart <= date).toBe(true);
            expect(date < bounds.endExclusive).toBe(true);
            expect(bounds.endExclusive).toBe(addDays(bounds.periodEnd, 1));
            expect(bounds.dueDate >= bounds.periodEnd).toBe(true);
            expect(calendar.invoiceKeyFor(bounds.periodStart)).toBe(key);
            expect(
              calendar.invoiceKeyFor(addDays(bounds.endExclusive, -1)),
            ).toBe(key);
          }
        }
      }
    });

    it('tiles consecutive invoices without gap or overlap', () => {
      for (const dueDay of dueDays) {
        for (const closingDaysBeforeDue of closings) {
          const calendar = new InvoiceCalendar({
            dueDay,
            closingDaysBeforeDue,
          });

          for (let year = 2024; year <= 2027; year++) {
            for (let month = 1; month <= 12; month++) {
              const key = monthKey(year, month);
              const current = calendar.bounds(key);
              const previous = calendar.bounds(previousKey(key));

              expect(current.periodStart).toBe(previous.endExclusive);
            }
          }
        }
      }
    });
  });
});
