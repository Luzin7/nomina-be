import { RECURRING_GENERATION_TIMEZONE } from '@constants/timezone';
import { SQL, sql } from 'drizzle-orm';
import * as schema from '../schema';

const rule = schema.recurringTransactions;
const row = schema.transactions;

const localDay = (
  instant: SQL | typeof row.date | typeof rule.startDate,
  timezone: string,
) => sql`((${instant} AT TIME ZONE ${timezone}::text)::date)`;

const nonZeroInterval = () => sql`nullif(${rule.interval}, 0)`;

const monthIndex = (day: SQL) =>
  sql`(extract(year from ${day}) * 12 + extract(month from ${day}))`;

const yearIndex = (day: SQL) => sql`extract(year from ${day})`;

const occurrenceIndex = (elapsed: SQL, step: SQL) =>
  sql`(floor((${elapsed})::numeric / ${step}) + 1)::int`;

const occurrencePositionAt = (
  instant: SQL | typeof row.date | typeof rule.startDate,
  timezone: string,
): SQL => {
  const day = localDay(instant, timezone);
  const startDay = localDay(rule.startDate, timezone);

  return sql`(case ${rule.frequency}
    when 'MONTHLY' then ${occurrenceIndex(sql`${monthIndex(day)} - ${monthIndex(startDay)}`, nonZeroInterval())}
    when 'WEEKLY' then ${occurrenceIndex(sql`${day} - ${startDay}`, sql`(7 * ${nonZeroInterval()})`)}
    when 'YEARLY' then ${occurrenceIndex(sql`${yearIndex(day)} - ${yearIndex(startDay)}`, nonZeroInterval())}
  end)`;
};

const occurrencePosition = (): SQL =>
  occurrencePositionAt(row.date, RECURRING_GENERATION_TIMEZONE);

const installmentStep = (): SQL => sql`(case ${rule.frequency}
  when 'MONTHLY' then make_interval(months => ${nonZeroInterval()})
  when 'WEEKLY' then make_interval(days => 7 * ${nonZeroInterval()})
  when 'YEARLY' then make_interval(years => ${nonZeroInterval()})
end)`;

const lastInstallmentDay = (timezone: string): SQL => sql`(
  ${localDay(rule.startDate, timezone)}
  + ${installmentStep()} * (${rule.installmentCount} - 1)
)::date`;

export const installmentPlanExhaustedAt = (
  instant: SQL | typeof rule.startDate,
  timezone: string,
): SQL => sql`(
  ${localDay(instant, timezone)} >= ${lastInstallmentDay(timezone)}
)`;

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
