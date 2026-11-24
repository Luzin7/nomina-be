import { AnyColumn, SQL, sql } from 'drizzle-orm';
import { instantOf } from '../sql-helpers';
import * as schema from '../schema';

const rule = schema.recurringTransactions;
const row = schema.transactions;

type Timezone = SQL | AnyColumn;

const localDay = (
  instant: SQL | typeof row.date | typeof rule.startDate,
  timezone: Timezone,
) => sql`((${instantOf(instant)} AT TIME ZONE ${timezone}::text)::date)`;

const nonZeroInterval = () => sql`nullif(${rule.interval}, 0)`;

const monthIndex = (day: SQL) =>
  sql`(extract(year from ${day}) * 12 + extract(month from ${day}))`;

const yearIndex = (day: SQL) => sql`extract(year from ${day})`;

const occurrenceIndex = (elapsed: SQL, step: SQL) =>
  sql`(floor((${elapsed})::numeric / ${step}) + 1)::int`;

const occurrencePositionAt = (
  instant: SQL | typeof row.date | typeof rule.startDate,
  timezone: Timezone,
): SQL => {
  const day = localDay(instant, timezone);
  const startDay = localDay(rule.startDate, timezone);

  return sql`(case ${rule.frequency}
    when 'MONTHLY' then ${occurrenceIndex(sql`${monthIndex(day)} - ${monthIndex(startDay)}`, nonZeroInterval())}
    when 'WEEKLY' then ${occurrenceIndex(sql`${day} - ${startDay}`, sql`(7 * ${nonZeroInterval()})`)}
    when 'YEARLY' then ${occurrenceIndex(sql`${yearIndex(day)} - ${yearIndex(startDay)}`, nonZeroInterval())}
  end)`;
};

const occurrencePosition = (timezone: Timezone): SQL =>
  occurrencePositionAt(row.date, timezone);

const installmentStep = (): SQL => sql`(case ${rule.frequency}
  when 'MONTHLY' then make_interval(months => ${nonZeroInterval()})
  when 'WEEKLY' then make_interval(days => 7 * ${nonZeroInterval()})
  when 'YEARLY' then make_interval(years => ${nonZeroInterval()})
end)`;

const lastInstallmentDay = (timezone: Timezone): SQL => sql`(
  ${localDay(rule.startDate, timezone)}
  + ${installmentStep()} * (${rule.installmentCount} - 1)
)::date`;

export const installmentPlanExhaustedAt = (
  instant: SQL | typeof rule.startDate,
  timezone: Timezone,
): SQL => sql`(
  ${localDay(instant, timezone)} >= ${lastInstallmentDay(timezone)}
)`;

const isInsideInstallmentPlan = (timezone: Timezone): SQL =>
  sql`${occurrencePosition(timezone)} between 1 and ${rule.installmentCount}`;

export const installmentNumberSql = (timezone: Timezone): SQL<number | null> =>
  sql<number | null>`(case
    when ${rule.installmentCount} is null then ${row.installmentNumber}
    when ${isInsideInstallmentPlan(timezone)} then ${occurrencePosition(timezone)}
  end)`;

export const installmentCountSql = (timezone: Timezone): SQL<number | null> =>
  sql<number | null>`(case
    when ${rule.installmentCount} is null then ${row.installmentCount}
    when ${isInsideInstallmentPlan(timezone)} then ${rule.installmentCount}
  end)`;
