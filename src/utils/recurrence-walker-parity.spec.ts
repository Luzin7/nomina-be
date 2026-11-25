import { RecurrenceFrequency } from '@constants/enums';
import { CalculateNextGenerationDateService } from '@modules/transaction/services/calculate-next-generation-date.service';
import { DayJsDateProvider } from '@providers/date/implementations/Dayjs';
import {
  calculateInstallmentEndDate,
  nextOccurrenceAfter,
} from './installmentSchedule';

const STEPS = 24;

const dateProvider = new DayJsDateProvider();
const generator = new CalculateNextGenerationDateService(dateProvider);

function scheduleCase(overrides: Record<string, unknown> = {}) {
  return {
    name: 'monthly from Jan 31 UTC',
    startDate: new Date('2026-01-31T12:00:00Z'),
    frequency: RecurrenceFrequency.MONTHLY,
    interval: 1,
    timezone: 'UTC',
    ...overrides,
  };
}

type ScheduleCase = ReturnType<typeof scheduleCase>;

const CASES: ScheduleCase[] = [
  scheduleCase(),
  scheduleCase({
    name: 'monthly from Aug 30 UTC',
    startDate: new Date('2025-08-30T12:00:00Z'),
  }),
  scheduleCase({
    name: 'monthly from Jan 31 Sao_Paulo',
    startDate: new Date('2026-01-31T03:00:00Z'),
    timezone: 'America/Sao_Paulo',
  }),
  scheduleCase({
    name: 'yearly from 2024-02-29 UTC',
    startDate: new Date('2024-02-29T12:00:00Z'),
    frequency: RecurrenceFrequency.YEARLY,
  }),
  scheduleCase({
    name: 'weekly Sao_Paulo DST start 2018-11-04',
    startDate: new Date('2018-10-28T03:00:00Z'),
    frequency: RecurrenceFrequency.WEEKLY,
    timezone: 'America/Sao_Paulo',
  }),
  scheduleCase({
    name: 'weekly Sao_Paulo DST end 2019-02-17',
    startDate: new Date('2019-02-10T02:00:00Z'),
    frequency: RecurrenceFrequency.WEEKLY,
    timezone: 'America/Sao_Paulo',
  }),
  scheduleCase({
    name: 'weekly New_York DST start 2026-03-08',
    startDate: new Date('2026-03-01T05:00:00Z'),
    frequency: RecurrenceFrequency.WEEKLY,
    timezone: 'America/New_York',
  }),
  scheduleCase({
    name: 'weekly New_York DST end 2026-11-01',
    startDate: new Date('2026-10-25T04:00:00Z'),
    frequency: RecurrenceFrequency.WEEKLY,
    timezone: 'America/New_York',
  }),
  scheduleCase({
    name: 'weekly UTC',
    startDate: new Date('2026-01-01T00:00:00Z'),
    frequency: RecurrenceFrequency.WEEKLY,
  }),
];

function generatorDates({
  startDate,
  frequency,
  interval,
  timezone,
}: ScheduleCase) {
  const dates = [startDate];
  while (dates.length < STEPS) {
    dates.push(
      generator.execute({
        anchorDate: startDate,
        baseDate: dates[dates.length - 1],
        frequency,
        interval,
        timezone,
      }),
    );
  }
  return dates.map((date) => date.toISOString());
}

function nextOccurrenceDates(scheduleInput: ScheduleCase) {
  const dates = [scheduleInput.startDate];
  while (dates.length < STEPS) {
    dates.push(
      nextOccurrenceAfter(scheduleInput, dates[dates.length - 1], dateProvider),
    );
  }
  return dates.map((date) => date.toISOString());
}

function installmentEndDates(scheduleInput: ScheduleCase) {
  return Array.from({ length: STEPS }, (_, index) =>
    calculateInstallmentEndDate(
      { ...scheduleInput, installments: index + 1 },
      dateProvider,
    ).toISOString(),
  );
}

describe('recurrence walker parity', () => {
  it.each(CASES)('generator matches nextOccurrence: $name', (scheduleInput) => {
    expect(generatorDates(scheduleInput)).toEqual(
      nextOccurrenceDates(scheduleInput),
    );
  });

  it.each(CASES)(
    'generator matches calculateInstallmentEndDate: $name',
    (scheduleInput) => {
      expect(generatorDates(scheduleInput)).toEqual(
        installmentEndDates(scheduleInput),
      );
    },
  );

  it.each(CASES)(
    'nextOccurrence matches calculateInstallmentEndDate: $name',
    (scheduleInput) => {
      expect(nextOccurrenceDates(scheduleInput)).toEqual(
        installmentEndDates(scheduleInput),
      );
    },
  );
});
