import { RecurrenceFrequency } from '@constants/enums';
import { formatZoned } from '@utils/zonedCalendar';

export const MAX_OCCURRENCE_STEPS = 1000;

export type RecurrenceRule = {
  frequency: RecurrenceFrequency;
  interval: number;
  timezone: string;
  startDate: Date;
  endDate: Date | null;
  lastGenerated: Date | null;
  materializedDates: Date[];
};

export type WalkOccurrencesInput<Rule extends RecurrenceRule> = {
  rule: Rule;
  from: Date;
  until: Date;
  nextOccurrence: (date: Date, rule: Rule) => Date;
  limit?: number;
};

const localDayOf = (date: Date, timezone: string): string =>
  formatZoned(date, 'YYYY-MM-DD', timezone);

const isBeyondRuleEnd = (rule: RecurrenceRule, cursor: Date): boolean =>
  rule.endDate !== null && cursor.getTime() > rule.endDate.getTime();

export const walkOccurrences = <Rule extends RecurrenceRule>({
  rule,
  from,
  until,
  nextOccurrence,
  limit = MAX_OCCURRENCE_STEPS,
}: WalkOccurrencesInput<Rule>): Date[] => {
  const occurrences: Date[] = [];
  const materializedDays = new Set(
    rule.materializedDates.map((date) => localDayOf(date, rule.timezone)),
  );
  let cursor = rule.lastGenerated
    ? nextOccurrence(rule.lastGenerated, rule)
    : rule.startDate;

  for (let step = 0; step < MAX_OCCURRENCE_STEPS; step++) {
    if (cursor.getTime() > until.getTime()) break;
    if (isBeyondRuleEnd(rule, cursor)) break;
    if (
      cursor.getTime() >= from.getTime() &&
      !materializedDays.has(localDayOf(cursor, rule.timezone))
    ) {
      occurrences.push(cursor);
      if (occurrences.length >= limit) break;
    }
    cursor = nextOccurrence(cursor, rule);
  }

  return occurrences;
};
