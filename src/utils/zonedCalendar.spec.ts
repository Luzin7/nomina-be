import {
  addZoned,
  formatZoned,
  isZonedFormat,
  type ZonedUnit,
} from './zonedCalendar';

type LocalStamp = { date: string; clock: string };

const oracle = (date: Date, timezone: string): LocalStamp => {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(date);
  const read = (type: string): string =>
    parts.find((part) => part.type === type)?.value ?? '';

  return {
    date: `${read('year')}-${read('month')}-${read('day')}`,
    clock: `${read('hour')}:${read('minute')}`,
  };
};

const anchored = (
  start: string,
  unit: ZonedUnit,
  timezone: string,
  steps: number,
): LocalStamp[] =>
  Array.from({ length: steps }, (_, index) =>
    oracle(addZoned(new Date(start), index + 1, unit, timezone), timezone),
  );

const weekly = (start: string, timezone: string, weeks: number): LocalStamp[] =>
  Array.from({ length: weeks }, (_, index) =>
    oracle(
      addZoned(new Date(start), (index + 1) * 7, 'day', timezone),
      timezone,
    ),
  );

const dates = (stamps: LocalStamp[]): string[] =>
  stamps.map((stamp) => stamp.date);

const clocks = (stamps: LocalStamp[]): string[] =>
  stamps.map((stamp) => stamp.clock);

const shiftDay = (date: string, days: number): string => {
  const [year, month, day] = date.split('-').map(Number);
  const shifted = new Date(Date.UTC(year, month - 1, day + days));

  return [
    shifted.getUTCFullYear(),
    String(shifted.getUTCMonth() + 1).padStart(2, '0'),
    String(shifted.getUTCDate()).padStart(2, '0'),
  ].join('-');
};

describe('zonedCalendar monthly steps', () => {
  it('keeps local midnight and day 15 from Auckland across the autumn change', () => {
    const stamps = anchored(
      '2026-01-14T11:00:00Z',
      'month',
      'Pacific/Auckland',
      5,
    );

    expect(dates(stamps)).toEqual([
      '2026-02-15',
      '2026-03-15',
      '2026-04-15',
      '2026-05-15',
      '2026-06-15',
    ]);
    expect(clocks(stamps)).toEqual(Array(5).fill('00:00'));
  });

  it('keeps local midnight and day 1 from Auckland across the autumn change', () => {
    const stamps = anchored(
      '2025-12-31T11:00:00Z',
      'month',
      'Pacific/Auckland',
      6,
    );

    expect(dates(stamps)).toEqual([
      '2026-02-01',
      '2026-03-01',
      '2026-04-01',
      '2026-05-01',
      '2026-06-01',
      '2026-07-01',
    ]);
    expect(clocks(stamps)).toEqual(Array(6).fill('00:00'));
  });

  it('keeps local midnight and day 1 from Lisbon across the autumn change', () => {
    const stamps = anchored(
      '2027-09-30T23:00:00Z',
      'month',
      'Europe/Lisbon',
      2,
    );

    expect(dates(stamps)).toEqual(['2027-11-01', '2027-12-01']);
    expect(clocks(stamps)).toEqual(['00:00', '00:00']);
  });

  it('keeps local midnight and day 2 from Lisbon across the autumn change', () => {
    const stamps = anchored(
      '2027-10-01T23:00:00Z',
      'month',
      'Europe/Lisbon',
      2,
    );

    expect(dates(stamps)).toEqual(['2027-11-02', '2027-12-02']);
    expect(clocks(stamps)).toEqual(['00:00', '00:00']);
  });

  it('keeps local midnight at UTC+14 in Kiritimati', () => {
    const stamps = anchored(
      '2026-01-14T10:00:00Z',
      'month',
      'Pacific/Kiritimati',
      3,
    );

    expect(dates(stamps)).toEqual(['2026-02-15', '2026-03-15', '2026-04-15']);
    expect(clocks(stamps)).toEqual(Array(3).fill('00:00'));
  });

  it('clamps month adds to the last day of the target month', () => {
    expect(
      addZoned(
        new Date('2024-01-31T15:00:00Z'),
        1,
        'month',
        'America/Sao_Paulo',
      ).toISOString(),
    ).toBe('2024-02-29T15:00:00.000Z');
  });
});

describe('zonedCalendar day steps', () => {
  it('keeps local midnight weekly across the Lisbon spring change', () => {
    const stamps = weekly('2027-03-21T00:00:00Z', 'Europe/Lisbon', 2);

    expect(dates(stamps)).toEqual(['2027-03-28', '2027-04-04']);
    expect(clocks(stamps)).toEqual(['00:00', '00:00']);
  });

  it('keeps local midnight weekly across the Lisbon autumn change', () => {
    const stamps = weekly('2027-10-23T23:00:00Z', 'Europe/Lisbon', 2);

    expect(dates(stamps)).toEqual(['2027-10-31', '2027-11-07']);
    expect(clocks(stamps)).toEqual(['00:00', '00:00']);
  });

  it('resolves a nonexistent local time forward by the gap', () => {
    const result = addZoned(
      new Date('2027-03-27T01:30:00Z'),
      1,
      'day',
      'Europe/Lisbon',
    );

    expect(oracle(result, 'Europe/Lisbon')).toEqual({
      date: '2027-03-28',
      clock: '02:30',
    });
  });

  it('resolves the Sao Paulo midnight gap forward', () => {
    const result = addZoned(
      new Date('2018-11-03T03:00:00Z'),
      1,
      'day',
      'America/Sao_Paulo',
    );

    expect(result.toISOString()).toBe('2018-11-04T03:00:00.000Z');
    expect(oracle(result, 'America/Sao_Paulo')).toEqual({
      date: '2018-11-04',
      clock: '01:00',
    });
  });

  it('resolves the New York 02:30 gap forward', () => {
    const result = addZoned(
      new Date('2024-03-09T07:30:00Z'),
      1,
      'day',
      'America/New_York',
    );

    expect(oracle(result, 'America/New_York')).toEqual({
      date: '2024-03-10',
      clock: '03:30',
    });
  });

  it('keeps the earlier offset on the New York fall-back overlap', () => {
    const result = addZoned(
      new Date('2024-11-02T05:30:00Z'),
      1,
      'day',
      'America/New_York',
    );

    expect(result.toISOString()).toBe('2024-11-03T05:30:00.000Z');
    expect(oracle(result, 'America/New_York')).toEqual({
      date: '2024-11-03',
      clock: '01:30',
    });
  });
});

describe('zonedCalendar signed month steps', () => {
  it('resolves the Santiago midnight gap forward without shifting later months', () => {
    const start = new Date('2024-07-08T04:00:00Z');

    expect(oracle(start, 'America/Santiago')).toEqual({
      date: '2024-07-08',
      clock: '00:00',
    });
    expect(
      oracle(
        addZoned(start, 2, 'month', 'America/Santiago'),
        'America/Santiago',
      ),
    ).toEqual({ date: '2024-09-08', clock: '01:00' });
    expect(
      oracle(
        addZoned(start, 3, 'month', 'America/Santiago'),
        'America/Santiago',
      ),
    ).toEqual({ date: '2024-10-08', clock: '00:00' });
    expect(
      oracle(
        addZoned(start, 4, 'month', 'America/Santiago'),
        'America/Santiago',
      ),
    ).toEqual({ date: '2024-11-08', clock: '00:00' });
  });

  it.each([
    [-12, '2026-03-15'],
    [-1, '2027-02-15'],
    [1, '2027-04-15'],
    [12, '2028-03-15'],
  ])('keeps local midnight when adding %i months', (months, date) => {
    const start = new Date('2027-03-15T03:00:00Z');

    expect(
      oracle(
        addZoned(start, months, 'month', 'America/Sao_Paulo'),
        'America/Sao_Paulo',
      ),
    ).toEqual({ date, clock: '00:00' });
  });

  it.each([
    [-1, '2026-06-15'],
    [1, '2028-06-15'],
  ])('keeps local midnight when adding %i years', (years, date) => {
    const start = new Date('2027-06-15T03:00:00Z');

    expect(
      oracle(
        addZoned(start, years, 'year', 'America/Sao_Paulo'),
        'America/Sao_Paulo',
      ),
    ).toEqual({ date, clock: '00:00' });
  });

  it.each([-7000, -1, 1, 7000])(
    'keeps local midnight when adding %i days',
    (days) => {
      const start = new Date('2027-03-15T03:00:00Z');

      expect(
        oracle(
          addZoned(start, days, 'day', 'America/Sao_Paulo'),
          'America/Sao_Paulo',
        ),
      ).toEqual({ date: shiftDay('2027-03-15', days), clock: '00:00' });
    },
  );
});

describe('zonedCalendar formatting', () => {
  it('formats the same local fields as the oracle', () => {
    const date = new Date('2027-03-28T01:30:00Z');

    expect(formatZoned(date, 'YYYY-MM-DD', 'Europe/Lisbon')).toBe(
      oracle(date, 'Europe/Lisbon').date,
    );
    expect(formatZoned(date, 'YYYY-MM', 'Europe/Lisbon')).toBe('2027-03');
    expect(formatZoned(date, 'D', 'Europe/Lisbon')).toBe('28');
  });

  it('recognizes only the supported format patterns', () => {
    expect(isZonedFormat('YYYY-MM-DD')).toBe(true);
    expect(isZonedFormat('YYYY-MM')).toBe(true);
    expect(isZonedFormat('D')).toBe(true);
    expect(isZonedFormat('DD/MM/YYYY - HH:mm:ss')).toBe(false);
  });
});
