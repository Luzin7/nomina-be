const monthFormat = (timezone: string): Intl.DateTimeFormat =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
  });

export const localMonthKey = (date: Date, timezone: string): string =>
  monthFormat(timezone).format(date);
