import { UnresolvableLocalTimeError } from './errors/UnresolvableLocalTimeError';

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

type WallClock = LocalFields & { millisecond: number };

const localFields = (epochMs: number, timezone: string): LocalFields => {
  const fields: Record<string, number> = {};
  for (const part of formatterFor(timezone).formatToParts(epochMs)) {
    if (part.type !== 'literal') fields[part.type] = Number(part.value);
  }
  return fields as LocalFields;
};

const positiveModulo = (value: number, modulus: number): number =>
  ((value % modulus) + modulus) % modulus;

const wallClockOf = (epochMs: number, timezone: string): WallClock => {
  const { year, month, day, hour, minute, second } = localFields(
    epochMs,
    timezone,
  );
  return {
    year,
    month,
    day,
    hour: hour % 24,
    minute,
    second,
    millisecond: positiveModulo(epochMs, 1000),
  };
};

const naiveMsOf = (clock: WallClock): number =>
  Date.UTC(
    clock.year,
    clock.month - 1,
    clock.day,
    clock.hour,
    clock.minute,
    clock.second,
    clock.millisecond,
  );

const offsetMs = (epochMs: number, timezone: string): number => {
  const { year, month, day, hour, minute, second } = localFields(
    epochMs,
    timezone,
  );
  const wholeSecondEpoch = epochMs - positiveModulo(epochMs, 1000);
  const localAsUtc = Date.UTC(year, month - 1, day, hour % 24, minute, second);
  return (
    Math.round((localAsUtc - wholeSecondEpoch) / MS_PER_MINUTE) * MS_PER_MINUTE
  );
};

const matchesWallClock = (
  epochMs: number,
  naiveMs: number,
  timezone: string,
): boolean => naiveMsOf(wallClockOf(epochMs, timezone)) === naiveMs;

const resolveInstant = (naiveMs: number, timezone: string): Date => {
  const beforeOffset = offsetMs(naiveMs - MS_PER_DAY, timezone);
  const afterOffset = offsetMs(naiveMs + MS_PER_DAY, timezone);
  const candidates = [naiveMs - beforeOffset, naiveMs - afterOffset].filter(
    (candidate) => matchesWallClock(candidate, naiveMs, timezone),
  );
  if (candidates.length > 0) return new Date(Math.min(...candidates));

  const shiftedMs = naiveMs + (afterOffset - beforeOffset);
  const shifted = shiftedMs - afterOffset;
  if (matchesWallClock(shifted, shiftedMs, timezone)) return new Date(shifted);

  throw new UnresolvableLocalTimeError({
    timezone,
    wallClock: new Date(naiveMs).toISOString(),
  });
};

const shiftedMonth = (clock: WallClock, months: number): WallClock => {
  const monthIndex = clock.month - 1 + months;
  const year = clock.year + Math.floor(monthIndex / MONTHS_PER_YEAR);
  const month = positiveModulo(monthIndex, MONTHS_PER_YEAR) + 1;
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return { ...clock, year, month, day: Math.min(clock.day, lastDay) };
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

const addDaysZoned = (date: Date, days: number, timezone: string): Date => {
  const naiveMs = naiveMsOf(wallClockOf(date.getTime(), timezone));
  return resolveInstant(naiveMs + days * MS_PER_DAY, timezone);
};

const addMonthsZoned = (date: Date, months: number, timezone: string): Date => {
  const clock = wallClockOf(date.getTime(), timezone);
  return resolveInstant(naiveMsOf(shiftedMonth(clock, months)), timezone);
};

export const addZoned = (
  date: Date,
  amount: number,
  unit: ZonedUnit,
  timezone: string,
): Date => {
  if (unit === 'day') return addDaysZoned(date, amount, timezone);
  const months = unit === 'year' ? amount * MONTHS_PER_YEAR : amount;
  return addMonthsZoned(date, months, timezone);
};
