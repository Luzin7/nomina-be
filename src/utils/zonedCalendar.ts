export type ZonedFormat = 'YYYY-MM-DD' | 'YYYY-MM' | 'D';
export type ZonedUnit = 'day' | 'month' | 'year';

const MS_PER_MINUTE = 60_000;
const MS_PER_DAY = 86_400_000;
const MONTHS_PER_YEAR = 12;
const SUPPORTED_FORMATS: readonly string[] = ['YYYY-MM-DD', 'YYYY-MM', 'D'];

const formatters = new Map<string, Intl.DateTimeFormat>();

const formatterFor = (timezone: string): Intl.DateTimeFormat => {
  const cached = formatters.get(timezone);
  if (cached) return cached;

  const created = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hourCycle: 'h23',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
  });
  formatters.set(timezone, created);
  return created;
};

type LocalFields = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

const localFields = (epochMs: number, timezone: string): LocalFields => {
  const fields: Record<string, number> = {};
  for (const part of formatterFor(timezone).formatToParts(epochMs)) {
    if (part.type !== 'literal') fields[part.type] = Number(part.value);
  }
  return fields as LocalFields;
};

const offsetMs = (epochMs: number, timezone: string): number => {
  const { year, month, day, hour, minute, second } = localFields(
    epochMs,
    timezone,
  );
  const wholeSecondEpoch = epochMs - (((epochMs % 1000) + 1000) % 1000);
  const localAsUtc = Date.UTC(year, month - 1, day, hour % 24, minute, second);
  return (
    Math.round((localAsUtc - wholeSecondEpoch) / MS_PER_MINUTE) * MS_PER_MINUTE
  );
};

const pad = (value: number, size: number): string =>
  String(value).padStart(size, '0');

export const isZonedFormat = (pattern: string): pattern is ZonedFormat =>
  SUPPORTED_FORMATS.includes(pattern);

export const formatZoned = (
  date: Date,
  pattern: ZonedFormat,
  timezone: string,
): string => {
  const { year, month, day } = localFields(date.getTime(), timezone);
  if (pattern === 'D') return String(day);
  if (pattern === 'YYYY-MM') return `${pad(year, 4)}-${pad(month, 2)}`;
  return `${pad(year, 4)}-${pad(month, 2)}-${pad(day, 2)}`;
};

const addMonthsZoned = (date: Date, months: number, timezone: string): Date => {
  const epochMs = date.getTime();
  const offset = offsetMs(epochMs, timezone);
  const local = new Date(epochMs + offset);
  const targetMonth = local.getUTCMonth() + months;
  const lastDay = new Date(
    Date.UTC(local.getUTCFullYear(), targetMonth + 1, 0),
  ).getUTCDate();
  const day = Math.min(local.getUTCDate(), lastDay);

  return new Date(
    Date.UTC(
      local.getUTCFullYear(),
      targetMonth,
      day,
      local.getUTCHours(),
      local.getUTCMinutes(),
      local.getUTCSeconds(),
      local.getUTCMilliseconds(),
    ) - offset,
  );
};

export const addZoned = (
  date: Date,
  amount: number,
  unit: ZonedUnit,
  timezone: string,
): Date => {
  if (unit === 'day') return new Date(date.getTime() + amount * MS_PER_DAY);
  const months = unit === 'year' ? amount * MONTHS_PER_YEAR : amount;
  return addMonthsZoned(date, months, timezone);
};
