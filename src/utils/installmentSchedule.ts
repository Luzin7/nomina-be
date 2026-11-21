import { RecurrenceFrequency } from '@constants/enums';
import { DateProvider } from '@providers/date/contracts/DateProvider';

export const MAX_INSTALLMENTS = 365;

const DAYS_PER_WEEK = 7;
const DAY_IN_MS = 24 * 60 * 60 * 1000;
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

const MONTHS_PER_YEAR = 12;
const YEAR_MONTH_FORMAT = 'YYYY-MM';

type CalendarStepper = Pick<DateProvider, 'add' | 'format'>;

function localMonthIndex(
  date: Date,
  timezone: string,
  dateProvider: Pick<DateProvider, 'format'>,
): number {
  const [year, month] = dateProvider
    .format(date, YEAR_MONTH_FORMAT, timezone)
    .split('-')
    .map(Number);

  return year * MONTHS_PER_YEAR + month;
}

function calendarPeriodIndex(
  schedule: ScheduleBase,
  date: Date,
  dateProvider: Pick<DateProvider, 'format'>,
): number {
  const months =
    localMonthIndex(date, schedule.timezone, dateProvider) -
    localMonthIndex(schedule.startDate, schedule.timezone, dateProvider);
  const monthsPerPeriod =
    schedule.frequency === RecurrenceFrequency.YEARLY
      ? MONTHS_PER_YEAR * schedule.interval
      : schedule.interval;

  return Math.floor(months / monthsPerPeriod);
}

function weeklyOccurrenceAfter(
  schedule: ScheduleBase,
  after: Date,
  dateProvider: DateAdder,
): Date {
  const weekMs = schedule.interval * DAYS_PER_WEEK * DAY_IN_MS;
  let index = Math.max(
    1,
    Math.floor((after.getTime() - schedule.startDate.getTime()) / weekMs),
  );
  let candidate = addOccurrences(schedule, index, dateProvider);

  while (candidate.getTime() <= after.getTime()) {
    index++;
    candidate = addOccurrences(schedule, index, dateProvider);
  }

  return candidate;
}

export function nextOccurrenceAfter(
  schedule: ScheduleBase,
  after: Date,
  dateProvider: CalendarStepper,
): Date {
  if (after.getTime() < schedule.startDate.getTime()) {
    return schedule.startDate;
  }
  if (schedule.frequency === RecurrenceFrequency.WEEKLY) {
    return weeklyOccurrenceAfter(schedule, after, dateProvider);
  }

  const period = calendarPeriodIndex(schedule, after, dateProvider);

  return addOccurrences(schedule, period + 1, dateProvider);
}

export function calculateInstallmentEndDate(
  input: InstallmentEndDateInput,
  dateProvider: DateAdder,
): Date {
  return addOccurrences(input, input.installments - 1, dateProvider);
}

export type PlanExhaustionInput = ScheduleBase & {
  installmentCount: number | null;
  endDate: Date | null;
};

function planLastDay(
  plan: PlanExhaustionInput,
  dateProvider: InferenceDateProvider,
): string | null {
  if (plan.endDate) {
    return localCalendarDate(plan.endDate, plan.timezone, dateProvider);
  }
  if (plan.installmentCount === null) return null;

  const lastInstallment = calculateInstallmentEndDate(
    { ...plan, installments: plan.installmentCount },
    dateProvider,
  );

  return localCalendarDate(lastInstallment, plan.timezone, dateProvider);
}

export function isPlanExhaustedBefore(
  plan: PlanExhaustionInput,
  instant: Date,
  dateProvider: InferenceDateProvider,
): boolean {
  const lastDay = planLastDay(plan, dateProvider);
  if (lastDay === null) return false;

  return localCalendarDate(instant, plan.timezone, dateProvider) > lastDay;
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
