import { RecurrenceFrequency } from '@constants/enums';

export const MAX_OCCURRENCE_STEPS = 1000;

export type RecurrenceRule = {
  frequency: RecurrenceFrequency;
  interval: number;
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

const isMaterialized = (rule: RecurrenceRule, date: Date): boolean =>
  rule.materializedDates.some((d) => d.getTime() === date.getTime());

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
  let cursor = rule.lastGenerated
    ? nextOccurrence(rule.lastGenerated, rule)
    : rule.startDate;

  for (let step = 0; step < MAX_OCCURRENCE_STEPS; step++) {
    if (cursor.getTime() > until.getTime()) break;
    if (isBeyondRuleEnd(rule, cursor)) break;
    if (cursor.getTime() >= from.getTime() && !isMaterialized(rule, cursor)) {
      occurrences.push(cursor);
      if (occurrences.length >= limit) break;
    }
    cursor = nextOccurrence(cursor, rule);
  }

  return occurrences;
};
