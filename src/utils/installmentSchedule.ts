import { RecurrenceFrequency } from '@constants/enums';
import { DateProvider } from '@providers/date/contracts/DateProvider';

export const MAX_INSTALLMENTS = 365;

const DAYS_PER_WEEK = 7;
const HALF_DAY_IN_MS = 12 * 60 * 60 * 1000;
const LOCAL_DATE_FORMAT = 'YYYY-MM-DD';

type DateAdder = Pick<DateProvider, 'add'>;
type InferenceDateProvider = Pick<
  DateProvider,
  'add' | 'format' | 'startOfDay'
>;

type ScheduleBase = {
  startDate: Date;
  frequency: RecurrenceFrequency;
  interval: number;
  timezone: string;
};

export type InstallmentEndDateInput = ScheduleBase & { installments: number };
export type InstallmentInferenceInput = ScheduleBase & { endDate: Date };

function addOccurrences(
  schedule: ScheduleBase,
  occurrences: number,
  dateProvider: DateAdder,
): Date {
  const { startDate, frequency, interval, timezone } = schedule;

  switch (frequency) {
    case RecurrenceFrequency.WEEKLY:
      return dateProvider.add(
        startDate,
        interval * DAYS_PER_WEEK * occurrences,
        'day',
        timezone,
      );
    case RecurrenceFrequency.MONTHLY:
      return dateProvider.add(
        startDate,
        interval * occurrences,
        'month',
        timezone,
      );
    case RecurrenceFrequency.YEARLY:
      return dateProvider.add(
        startDate,
        interval * occurrences,
        'year',
        timezone,
      );
    default:
      throw new Error(`Unknown frequency: ${frequency as string}`);
  }
}

export function nextOccurrence(
  schedule: ScheduleBase,
  dateProvider: DateAdder,
): Date {
  return addOccurrences(schedule, 1, dateProvider);
}

export function calculateInstallmentEndDate(
  input: InstallmentEndDateInput,
  dateProvider: DateAdder,
): Date {
  return addOccurrences(input, input.installments - 1, dateProvider);
}

function localCalendarDate(
  date: Date,
  timezone: string,
  dateProvider: Pick<DateProvider, 'format'>,
): string {
  return dateProvider.format(date, LOCAL_DATE_FORMAT, timezone);
}

function localNoonOfStartDay(
  input: ScheduleBase,
  dateProvider: InferenceDateProvider,
): Date {
  const startDay = localCalendarDate(
    input.startDate,
    input.timezone,
    dateProvider,
  );
  const localMidnight = dateProvider.startOfDay(startDay, input.timezone);

  return new Date(localMidnight.getTime() + HALF_DAY_IN_MS);
}

export function inferInstallmentCount(
  input: InstallmentInferenceInput,
  dateProvider: InferenceDateProvider,
): number | null {
  const target = localCalendarDate(input.endDate, input.timezone, dateProvider);
  const noonSchedule = {
    ...input,
    startDate: localNoonOfStartDay(input, dateProvider),
  };

  for (let installments = 1; installments <= MAX_INSTALLMENTS; installments++) {
    const calendarDate = localCalendarDate(
      calculateInstallmentEndDate(
        { ...noonSchedule, installments },
        dateProvider,
      ),
      input.timezone,
      dateProvider,
    );
    const storedDate = localCalendarDate(
      calculateInstallmentEndDate({ ...input, installments }, dateProvider),
      input.timezone,
      dateProvider,
    );

    if (calendarDate === target || storedDate === target) return installments;
    if (calendarDate > target && storedDate > target) return null;
  }

  return null;
}
