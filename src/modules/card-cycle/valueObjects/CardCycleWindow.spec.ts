import { CardCycleNotConfiguredError } from '@modules/card-cycle/errors';
import { CardCycleWindow } from './CardCycleWindow';

const utcDateOf = (instant: Date): string =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'UTC' }).format(instant);

describe('CardCycleWindow', () => {
  describe('dueDay 28 closing 7 days before due', () => {
    const createWindow = (dueDate: string): CardCycleWindow =>
      CardCycleWindow.create({ dueDate, dueDay: 28, closingDaysBeforeDue: 7 });

    it('derives the window of the december cycle', () => {
      expect(createWindow('2026-12-28').toRecord()).toEqual({
        dueDate: '2026-12-28',
        periodStart: '2026-11-22',
        periodEnd: '2026-12-21',
        dueDay: 28,
        closingDaysBeforeDue: 7,
      });
    });

    it('derives the window of the following january cycle', () => {
      expect(createWindow('2027-01-28').toRecord()).toEqual({
        dueDate: '2027-01-28',
        periodStart: '2026-12-22',
        periodEnd: '2027-01-21',
        dueDay: 28,
        closingDaysBeforeDue: 7,
      });
    });

    it('starts the next window on the day after the previous closing', () => {
      const december = createWindow('2026-12-28');
      const january = createWindow('2027-01-28');

      expect(january.periodStart).toBe('2026-12-22');
      expect(december.periodEnd).toBe('2026-12-21');
    });
  });

  describe('inclusive end bound', () => {
    const window = CardCycleWindow.create({
      dueDate: '2026-12-28',
      dueDay: 28,
      closingDaysBeforeDue: 7,
    });

    it('includes the closing day itself', () => {
      expect(window.contains('2026-12-21')).toBe(true);
    });

    it('excludes the day after the closing day', () => {
      expect(window.contains('2026-12-22')).toBe(false);
    });

    it('includes the first day of the window and excludes the day before it', () => {
      expect(window.contains('2026-11-22')).toBe(true);
      expect(window.contains('2026-11-21')).toBe(false);
    });

    it('includes an instant on the closing day and excludes the next UTC midnight', () => {
      expect(
        window.contains(utcDateOf(new Date('2026-12-21T23:59:59.999Z'))),
      ).toBe(true);
      expect(
        window.contains(utcDateOf(new Date('2026-12-22T00:00:00.000Z'))),
      ).toBe(false);
    });
  });

  describe('month length', () => {
    it('closes february with the previous january due date', () => {
      const window = CardCycleWindow.create({
        dueDate: '2027-02-28',
        dueDay: 28,
        closingDaysBeforeDue: 7,
      });

      expect(window.toRecord()).toEqual({
        dueDate: '2027-02-28',
        periodStart: '2027-01-22',
        periodEnd: '2027-02-21',
        dueDay: 28,
        closingDaysBeforeDue: 7,
      });
    });

    it('closes march from the short february due date', () => {
      const window = CardCycleWindow.create({
        dueDate: '2026-03-28',
        dueDay: 28,
        closingDaysBeforeDue: 7,
      });

      expect(window.periodStart).toBe('2026-02-22');
      expect(window.periodEnd).toBe('2026-03-21');
    });

    it('crosses the year boundary without shifting the day', () => {
      const window = CardCycleWindow.create({
        dueDate: '2026-01-01',
        dueDay: 1,
        closingDaysBeforeDue: 7,
      });

      expect(window.toRecord()).toEqual({
        dueDate: '2026-01-01',
        periodStart: '2025-11-25',
        periodEnd: '2025-12-25',
        dueDay: 1,
        closingDaysBeforeDue: 7,
      });
    });
  });

  describe('card without a due day', () => {
    it('refuses to guess a window', () => {
      expect(() =>
        CardCycleWindow.create({
          dueDate: '2026-12-28',
          dueDay: null,
          closingDaysBeforeDue: 7,
        }),
      ).toThrow(CardCycleNotConfiguredError);
    });
  });
});
