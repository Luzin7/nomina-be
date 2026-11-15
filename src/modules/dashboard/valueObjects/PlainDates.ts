const MS_PER_DAY = 86_400_000;

const utcOf = (date: string): number => {
  const [year, month, day] = date.split('-').map(Number);
  return Date.UTC(year, month - 1, day);
};

export const calendarDaysBetween = (from: string, to: string): number =>
  Math.round((utcOf(to) - utcOf(from)) / MS_PER_DAY);

export const monthKeyOf = (date: string, monthsAhead: number): string => {
  const [year, month] = date.split('-').map(Number);
  const index = year * 12 + (month - 1) + monthsAhead;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, '0')}`;
};
