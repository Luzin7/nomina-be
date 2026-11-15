import fixture from './zonedCalendar.fixture.json';
import {
  addZoned,
  formatZoned,
  isZonedFormat,
  type ZonedFormat,
  type ZonedUnit,
} from './zonedCalendar';

type FixtureOperation =
  | { kind: 'format'; pattern: ZonedFormat }
  | { kind: 'add'; amount: number; unit: ZonedUnit };

type FixtureCase = {
  timezone: string;
  operation: FixtureOperation;
  expected: (string | number)[];
};

const { instants, cases } = fixture as {
  instants: number[];
  cases: FixtureCase[];
};

const applyOperation = (
  operation: FixtureOperation,
  epoch: number,
  timezone: string,
): string | number =>
  operation.kind === 'format'
    ? formatZoned(new Date(epoch), operation.pattern, timezone)
    : addZoned(
        new Date(epoch),
        operation.amount,
        operation.unit,
        timezone,
      ).getTime();

describe('zonedCalendar', () => {
  it.each(cases)(
    'matches the dayjs golden fixture for $timezone $operation',
    ({ timezone, operation, expected }) => {
      const actual = instants.map((epoch) =>
        applyOperation(operation, epoch, timezone),
      );

      expect(actual).toEqual(expected);
    },
  );

  it.each([
    ['2018-10-28T03:00:00.000Z', 7, 'day', '2018-11-04T03:00:00.000Z'],
    ['2019-02-10T02:00:00.000Z', 7, 'day', '2019-02-17T02:00:00.000Z'],
    ['2019-02-17T02:00:00.000Z', 7, 'day', '2019-02-24T02:00:00.000Z'],
    ['2024-01-31T15:00:00.000Z', 1, 'month', '2024-02-29T15:00:00.000Z'],
  ] as const)('adds %s %i %s to %s in Sao Paulo', (from, amount, unit, to) => {
    expect(
      addZoned(new Date(from), amount, unit, 'America/Sao_Paulo').toISOString(),
    ).toBe(to);
  });

  it('clamps month add to the last day of the target month', () => {
    const result = addZoned(
      new Date('2024-01-31T15:00:00.000Z'),
      1,
      'month',
      'America/Sao_Paulo',
    );

    expect(result.toISOString()).toBe('2024-02-29T15:00:00.000Z');
  });

  it('recognizes only the supported format patterns', () => {
    expect(isZonedFormat('YYYY-MM-DD')).toBe(true);
    expect(isZonedFormat('YYYY-MM')).toBe(true);
    expect(isZonedFormat('D')).toBe(true);
    expect(isZonedFormat('DD/MM/YYYY - HH:mm:ss')).toBe(false);
  });
});
