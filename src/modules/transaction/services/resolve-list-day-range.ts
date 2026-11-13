import { DateProvider } from '@providers/date/contracts/DateProvider';

type DayRangeInput = {
  startDate?: string;
  endDate?: string;
  timezone: string;
};

export function resolveListDayRange(
  dateProvider: DateProvider,
  { startDate, endDate, timezone }: DayRangeInput,
): { startDate?: Date; endDate?: Date } {
  return {
    startDate: startDate
      ? dateProvider.startOfDay(startDate, timezone)
      : undefined,
    endDate: endDate ? dateProvider.endOfDay(endDate, timezone) : undefined,
  };
}
