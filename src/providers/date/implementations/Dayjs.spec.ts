import { DayJsDateProvider } from './Dayjs';

describe('DayJsDateProvider', () => {
  let provider: DayJsDateProvider;

  beforeEach(() => {
    provider = new DayJsDateProvider();
  });

  /**
   * Regression tests for timezone-aware date parsing.
   *
   * Bug: When a date string "YYYY-MM-DD" was passed to methods like startOfDay,
   * dayjs parsed it as UTC midnight, then converted to the local timezone,
   * shifting the calendar date back by one day for UTC-3 (America/Sao_Paulo).
   *
   * Fix: Use dayjs.tz(date, tz) for string inputs so the string is interpreted
   * directly in the target timezone.
   */
  describe('startOfDay', () => {
    it('should return the start of the given day in the specified timezone (not the previous day)', () => {
      const result = provider.startOfDay('2026-05-04', 'America/Sao_Paulo');

      expect(result.getUTCFullYear()).toBe(2026);
      expect(result.getUTCMonth()).toBe(4); // May = 4
      expect(result.getUTCDate()).toBe(4);
      // UTC-3 midnight = 03:00 UTC
      expect(result.getUTCHours()).toBe(3);
      expect(result.getUTCMinutes()).toBe(0);
    });

    it('should NOT shift the date back one day for UTC-3 timezones', () => {
      const result = provider.startOfDay('2026-01-01', 'America/Sao_Paulo');

      // Before the fix: dayjs("2026-01-01") → UTC midnight → converted to SP
      // → 2025-12-31T21:00-03:00 → startOf('day') → 2025-12-31
      expect(result.getUTCFullYear()).toBe(2026);
      expect(result.getUTCMonth()).toBe(0); // January
      expect(result.getUTCDate()).toBe(1);
    });

    it('should work correctly for Date object inputs', () => {
      const input = new Date('2026-05-04T12:00:00Z');
      const result = provider.startOfDay(input, 'America/Sao_Paulo');

      // 2026-05-04T12:00Z is 2026-05-04T09:00-03:00 → startOf day = 2026-05-04T00:00-03:00 = 2026-05-04T03:00Z
      expect(result.getUTCFullYear()).toBe(2026);
      expect(result.getUTCMonth()).toBe(4);
      expect(result.getUTCDate()).toBe(4);
    });

    it('should work for UTC timezone', () => {
      const result = provider.startOfDay('2026-05-04', 'UTC');

      expect(result.getUTCFullYear()).toBe(2026);
      expect(result.getUTCMonth()).toBe(4);
      expect(result.getUTCDate()).toBe(4);
      expect(result.getUTCHours()).toBe(0);
    });
  });

  describe('endOfDay', () => {
    it('should return the end of the given day in the specified timezone (not the previous day)', () => {
      const result = provider.endOfDay('2026-05-04', 'America/Sao_Paulo');

      // End of 2026-05-04 in SP (-03:00) = 2026-05-04T23:59:59-03:00 = 2026-05-05T02:59:59Z
      expect(result.getUTCFullYear()).toBe(2026);
      expect(result.getUTCMonth()).toBe(4);
      expect(result.getUTCDate()).toBe(5);
      expect(result.getUTCHours()).toBe(2);
      expect(result.getUTCMinutes()).toBe(59);
    });

    it('should NOT shift the date back one day for UTC-3 timezones', () => {
      const result = provider.endOfDay('2026-01-01', 'America/Sao_Paulo');

      // End of 2026-01-01 in SP (-03:00) = 2026-01-01T23:59:59.999-03:00 = 2026-01-02T02:59:59.999Z
      // The important check: the local calendar date is Jan 1, not Dec 31
      const localDate = new Date(
        result.toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }),
      );
      expect(localDate.getFullYear()).toBe(2026);
      expect(localDate.getMonth()).toBe(0);
      expect(localDate.getDate()).toBe(1);
    });
  });

  describe('startOfMonth', () => {
    it('should return the first day of the given month in the specified timezone', () => {
      const result = provider.startOfMonth('2026-05-15', 'America/Sao_Paulo');

      // First of May in SP (-03:00) = 2026-05-01T00:00:00-03:00 = 2026-05-01T03:00:00Z
      expect(result.getUTCFullYear()).toBe(2026);
      expect(result.getUTCMonth()).toBe(4);
      expect(result.getUTCDate()).toBe(1);
      expect(result.getUTCHours()).toBe(3);
    });

    it('should NOT return the last day of the previous month for UTC-3 timezones', () => {
      const result = provider.startOfMonth('2026-01-15', 'America/Sao_Paulo');

      // Before the fix: "2026-01-15" → UTC midnight → Dec 31 in SP → startOfMonth = Dec 1
      // After the fix: interpreted as Jan 15 in SP → startOfMonth = Jan 1 in SP
      expect(result.getUTCFullYear()).toBe(2026);
      expect(result.getUTCMonth()).toBe(0); // January, not December
    });
  });

  describe('endOfMonth', () => {
    it('should return the last day of the given month in the specified timezone', () => {
      const result = provider.endOfMonth('2026-05-15', 'America/Sao_Paulo');

      // Last of May in SP = 2026-05-31T23:59:59-03:00 = 2026-06-01T02:59:59Z
      const localDate = new Date(
        result.toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }),
      );
      expect(localDate.getFullYear()).toBe(2026);
      expect(localDate.getMonth()).toBe(4); // May
      expect(localDate.getDate()).toBe(31);
    });
  });
});
