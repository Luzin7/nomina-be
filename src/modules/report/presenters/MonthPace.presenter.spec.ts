import {
  buildMonthPace,
  type MonthPaceInput,
} from '@modules/report/valueObjects/MonthPace';
import { MonthPacePresenter } from './MonthPace.presenter';

const makePace = (overrides: Partial<MonthPaceInput> = {}) =>
  buildMonthPace({
    month: '2026-11',
    daysInMonth: 3,
    today: 2,
    spentByDay: { 1: 1_000 },
    planTotalCents: 3_000,
    planSource: 'declared',
    fixedByDay: {},
    controlled: {
      planTotalCents: 2_000,
      spentByDay: { 1: 400 },
      fixedByDay: {},
    },
    ...overrides,
  });

describe('MonthPacePresenter', () => {
  it('carries the controlled curve on the payload', () => {
    expect(MonthPacePresenter.toHTTP(makePace())).toEqual({
      month: '2026-11',
      daysInMonth: 3,
      today: 2,
      planTotalCents: 3_000,
      planSource: 'declared',
      controlledPlanTotalCents: 2_000,
      days: [
        {
          day: 1,
          spentCents: 1_000,
          planCents: 1_000,
          controlledSpentCents: 400,
          controlledPlanCents: 666,
        },
        {
          day: 2,
          spentCents: 1_000,
          planCents: 2_000,
          controlledSpentCents: 400,
          controlledPlanCents: 1_332,
        },
        {
          day: 3,
          spentCents: null,
          planCents: 3_000,
          controlledSpentCents: null,
          controlledPlanCents: 2_000,
        },
      ],
    });
  });

  it('carries null controlled fields without a declared plan', () => {
    const payload = MonthPacePresenter.toHTTP(
      makePace({
        planTotalCents: null,
        planSource: null,
        controlled: null,
      }),
    );

    expect(payload.controlledPlanTotalCents).toBeNull();
    expect(payload.days.every((day) => day.controlledPlanCents === null)).toBe(
      true,
    );
  });
});
