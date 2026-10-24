import { RECURRING_GENERATION_TIMEZONE } from '@constants/timezone';
import { SQL, sql } from 'drizzle-orm';
import * as schema from '../schema';

const rule = schema.recurringTransactions;
const row = schema.transactions;

const localDay = (instant: SQL | typeof row.date | typeof rule.startDate) =>
  sql`((${instant} AT TIME ZONE ${RECURRING_GENERATION_TIMEZONE}::text)::date)`;

const nonZeroInterval = () => sql`nullif(${rule.interval}, 0)`;

const monthIndex = (day: SQL) =>
  sql`(extract(year from ${day}) * 12 + extract(month from ${day}))`;

const yearIndex = (day: SQL) => sql`extract(year from ${day})`;

const occurrenceIndex = (elapsed: SQL, step: SQL) =>
  sql`(floor((${elapsed})::numeric / ${step}) + 1)::int`;

const occurrencePosition = (): SQL => {
  const rowDay = localDay(row.date);
  const startDay = localDay(rule.startDate);

  return sql`(case ${rule.frequency}
    when 'MONTHLY' then ${occurrenceIndex(sql`${monthIndex(rowDay)} - ${monthIndex(startDay)}`, nonZeroInterval())}
    when 'WEEKLY' then ${occurrenceIndex(sql`${rowDay} - ${startDay}`, sql`(7 * ${nonZeroInterval()})`)}
    when 'YEARLY' then ${occurrenceIndex(sql`${yearIndex(rowDay)} - ${yearIndex(startDay)}`, nonZeroInterval())}
  end)`;
};

const isInsideInstallmentPlan = (): SQL =>
  sql`${occurrencePosition()} between 1 and ${rule.installmentCount}`;

export const installmentNumberSql = (): SQL<number | null> =>
  sql<number | null>`(case
    when ${rule.installmentCount} is null then ${row.installmentNumber}
    when ${isInsideInstallmentPlan()} then ${occurrencePosition()}
  end)`;

export const installmentCountSql = (): SQL<number | null> =>
  sql<number | null>`(case
    when ${rule.installmentCount} is null then ${row.installmentCount}
    when ${isInsideInstallmentPlan()} then ${rule.installmentCount}
  end)`;
