import { RecurrenceFrequency } from '@constants/enums';
import { RECURRING_GENERATION_TIMEZONE } from '@constants/timezone';
import { DayJsDateProvider } from '@providers/date/implementations/Dayjs';
import { nextOccurrenceAfter } from '@utils/installmentSchedule';
import {
  MAX_OCCURRENCE_STEPS,
  RecurrenceRule,
  walkOccurrences,
} from '@utils/recurrenceWalk';

const dateProvider = new DayJsDateProvider();

const stepOf = (date: Date, rule: RecurrenceRule): Date =>
  nextOccurrenceAfter(
    {
      startDate: rule.startDate,
      frequency: rule.frequency,
      interval: rule.interval,
      timezone: RECURRING_GENERATION_TIMEZONE,
    },
    date,
    dateProvider,
  );

const makeRule = (overrides: Partial<RecurrenceRule> = {}): RecurrenceRule => ({
  frequency: RecurrenceFrequency.MONTHLY,
  interval: 1,
  startDate: new Date('2026-01-10T12:00:00.000Z'),
  endDate: null,
  lastGenerated: null,
  materializedDates: [],
  ...overrides,
});

const walk = (
  rule: RecurrenceRule,
  from: string,
  until: string,
  limit?: number,
): string[] =>
  walkOccurrences({
    rule,
    from: new Date(from),
    until: new Date(until),
    nextOccurrence: stepOf,
    limit,
  }).map((date) => date.toISOString());

describe('walkOccurrences', () => {
  it('lists occurrences inside the window', () => {
    expect(
      walk(makeRule(), '2026-02-01T00:00:00.000Z', '2026-04-30T23:59:59.999Z'),
    ).toEqual([
      '2026-02-10T12:00:00.000Z',
      '2026-03-10T12:00:00.000Z',
      '2026-04-10T12:00:00.000Z',
    ]);
  });

  it.each([
    [
      '2026-01-29T12:00:00.000Z',
      [
        '2026-02-28T12:00:00.000Z',
        '2026-03-29T12:00:00.000Z',
        '2026-04-29T12:00:00.000Z',
        '2026-05-29T12:00:00.000Z',
        '2026-06-29T12:00:00.000Z',
      ],
    ],
    [
      '2026-01-30T12:00:00.000Z',
      [
        '2026-02-28T12:00:00.000Z',
        '2026-03-30T12:00:00.000Z',
        '2026-04-30T12:00:00.000Z',
        '2026-05-30T12:00:00.000Z',
        '2026-06-30T12:00:00.000Z',
      ],
    ],
    [
      '2026-01-31T12:00:00.000Z',
      [
        '2026-02-28T12:00:00.000Z',
        '2026-03-31T12:00:00.000Z',
        '2026-04-30T12:00:00.000Z',
        '2026-05-31T12:00:00.000Z',
        '2026-06-30T12:00:00.000Z',
      ],
    ],
  ])('anchors a monthly rule starting %s to its day', (start, expected) => {
    expect(
      walk(
        makeRule({ startDate: new Date(start) }),
        '2026-01-01T00:00:00.000Z',
        '2026-06-30T23:59:59.999Z',
      ),
    ).toEqual([start, ...expected]);
  });

  it('stops after the rule end date', () => {
    expect(
      walk(
        makeRule({ endDate: new Date('2026-03-10T12:00:00.000Z') }),
        '2026-01-01T00:00:00.000Z',
        '2026-12-31T23:59:59.999Z',
      ),
    ).toEqual([
      '2026-01-10T12:00:00.000Z',
      '2026-02-10T12:00:00.000Z',
      '2026-03-10T12:00:00.000Z',
    ]);
  });

  it('skips materialized dates', () => {
    expect(
      walk(
        makeRule({
          materializedDates: [new Date('2026-02-10T12:00:00.000Z')],
        }),
        '2026-01-01T00:00:00.000Z',
        '2026-03-31T23:59:59.999Z',
      ),
    ).toEqual(['2026-01-10T12:00:00.000Z', '2026-03-10T12:00:00.000Z']);
  });

  it('starts after lastGenerated', () => {
    expect(
      walk(
        makeRule({ lastGenerated: new Date('2026-02-10T12:00:00.000Z') }),
        '2026-01-01T00:00:00.000Z',
        '2026-04-30T23:59:59.999Z',
      ),
    ).toEqual(['2026-03-10T12:00:00.000Z', '2026-04-10T12:00:00.000Z']);
  });

  it('stops once the limit is reached without stepping further', () => {
    const nextOccurrenceSpy = jest.fn(stepOf);

    const result = walkOccurrences({
      rule: makeRule(),
      from: new Date('2026-03-01T00:00:00.000Z'),
      until: new Date('2026-12-31T23:59:59.999Z'),
      nextOccurrence: nextOccurrenceSpy,
      limit: 1,
    });

    expect(result).toEqual([new Date('2026-03-10T12:00:00.000Z')]);
    expect(nextOccurrenceSpy).toHaveBeenCalledTimes(2);
  });

  it('caps the walk at MAX_OCCURRENCE_STEPS', () => {
    const nextOccurrenceSpy = jest.fn(
      (date: Date) => new Date(date.getTime() + 1),
    );

    walkOccurrences({
      rule: makeRule(),
      from: new Date('2100-01-01T00:00:00.000Z'),
      until: new Date('2200-01-01T00:00:00.000Z'),
      nextOccurrence: nextOccurrenceSpy,
    });

    expect(nextOccurrenceSpy).toHaveBeenCalledTimes(MAX_OCCURRENCE_STEPS);
  });
});
