import { RecurrenceFrequency } from '@constants/enums';
import { DateProvider } from '@providers/date/contracts/DateProvider';
import { DEFAULT_TIMEZONE } from '@constants/timezone';
import { CalculateNextGenerationDateService } from '@modules/transaction/services/calculate-next-generation-date.service';
import { DayJsDateProvider } from '@providers/date/implementations/Dayjs';
import {
  calculateInstallmentEndDate,
  inferInstallmentCount,
  isPlanExhaustedBefore,
  nextOccurrence,
  nextOccurrenceAfter,
} from './installmentSchedule';

const dateProvider = {
  add: (date: Date, amount: number, unit: string) => {
    const result = new Date(date);
    if (unit === 'day') result.setUTCDate(result.getUTCDate() + amount);
    if (unit === 'month') result.setUTCMonth(result.getUTCMonth() + amount);
    if (unit === 'year')
      result.setUTCFullYear(result.getUTCFullYear() + amount);
    return result;
  },
  format: (date: Date) => date.toISOString().slice(0, 10),
  startOfDay: (date: string | Date) =>
    new Date(`${String(date).slice(0, 10)}T00:00:00Z`),
} as Pick<DateProvider, 'add' | 'format' | 'startOfDay'>;

const TIMEZONE = 'UTC';

function schedule(overrides: Record<string, unknown> = {}) {
  return {
    startDate: new Date('2099-01-15T00:00:00Z'),
    frequency: RecurrenceFrequency.MONTHLY,
    interval: 1,
    timezone: TIMEZONE,
    ...overrides,
  };
}

describe('calculateInstallmentEndDate', () => {
  it('should return the start date for a single installment', () => {
    expect(
      calculateInstallmentEndDate(
        { ...schedule(), installments: 1 },
        dateProvider,
      ),
    ).toEqual(new Date('2099-01-15T00:00:00Z'));
  });

  it('should step monthly installments by the interval', () => {
    expect(
      calculateInstallmentEndDate(
        { ...schedule({ interval: 2 }), installments: 4 },
        dateProvider,
      ),
    ).toEqual(new Date('2099-07-15T00:00:00Z'));
  });

  it('should step weekly installments in seven-day units', () => {
    expect(
      calculateInstallmentEndDate(
        {
          ...schedule({ frequency: RecurrenceFrequency.WEEKLY }),
          installments: 3,
        },
        dateProvider,
      ),
    ).toEqual(new Date('2099-01-29T00:00:00Z'));
  });
});

describe('inferInstallmentCount', () => {
  it('should infer a monthly count', () => {
    expect(
      inferInstallmentCount(
        { ...schedule(), endDate: new Date('2099-06-15T00:00:00Z') },
        dateProvider,
      ),
    ).toBe(6);
  });

  it('should infer a weekly count', () => {
    expect(
      inferInstallmentCount(
        {
          ...schedule({ frequency: RecurrenceFrequency.WEEKLY }),
          endDate: new Date('2099-02-05T00:00:00Z'),
        },
        dateProvider,
      ),
    ).toBe(4);
  });

  it('should respect the interval', () => {
    expect(
      inferInstallmentCount(
        {
          ...schedule({ interval: 2 }),
          endDate: new Date('2099-09-15T00:00:00Z'),
        },
        dateProvider,
      ),
    ).toBe(5);
  });

  it('should infer a yearly count', () => {
    expect(
      inferInstallmentCount(
        {
          ...schedule({ frequency: RecurrenceFrequency.YEARLY }),
          endDate: new Date('2101-01-15T00:00:00Z'),
        },
        dateProvider,
      ),
    ).toBe(3);
  });

  it('should infer one installment when the end date equals the start date', () => {
    expect(
      inferInstallmentCount(
        { ...schedule(), endDate: new Date('2099-01-15T00:00:00Z') },
        dateProvider,
      ),
    ).toBe(1);
  });

  it('should return null when the end date is off the grid', () => {
    expect(
      inferInstallmentCount(
        { ...schedule(), endDate: new Date('2099-06-20T00:00:00Z') },
        dateProvider,
      ),
    ).toBeNull();
  });

  it('should return null when the end date is before the start date', () => {
    expect(
      inferInstallmentCount(
        { ...schedule(), endDate: new Date('2098-01-15T00:00:00Z') },
        dateProvider,
      ),
    ).toBeNull();
  });

  it('should return null beyond the maximum installments', () => {
    expect(
      inferInstallmentCount(
        { ...schedule(), endDate: new Date('2140-01-15T00:00:00Z') },
        dateProvider,
      ),
    ).toBeNull();
  });
});

describe('inferInstallmentCount across a DST change', () => {
  const realDateProvider = new DayJsDateProvider();

  it('should infer the count in New York when the end date is a local calendar date', () => {
    expect(
      inferInstallmentCount(
        {
          startDate: new Date('2099-03-02T05:00:00Z'),
          endDate: new Date('2099-03-23T04:00:00Z'),
          frequency: RecurrenceFrequency.WEEKLY,
          interval: 1,
          timezone: 'America/New_York',
        },
        realDateProvider,
      ),
    ).toBe(4);
  });

  it('should infer the count in New York for monthly plans over the spring change', () => {
    expect(
      inferInstallmentCount(
        {
          startDate: new Date('2099-02-15T05:00:00Z'),
          endDate: new Date('2099-05-15T04:00:00Z'),
          frequency: RecurrenceFrequency.MONTHLY,
          interval: 1,
          timezone: 'America/New_York',
        },
        realDateProvider,
      ),
    ).toBe(4);
  });

  it('should infer the count in Lisbon starting in winter', () => {
    expect(
      inferInstallmentCount(
        {
          startDate: new Date('2099-01-15T00:00:00Z'),
          endDate: new Date('2099-06-14T23:00:00Z'),
          frequency: RecurrenceFrequency.MONTHLY,
          interval: 1,
          timezone: 'Europe/Lisbon',
        },
        realDateProvider,
      ),
    ).toBe(6);
  });

  it('should infer the count in Lisbon starting in summer', () => {
    expect(
      inferInstallmentCount(
        {
          startDate: new Date('2099-06-30T23:00:00Z'),
          endDate: new Date('2099-12-01T00:00:00Z'),
          frequency: RecurrenceFrequency.MONTHLY,
          interval: 1,
          timezone: 'Europe/Lisbon',
        },
        realDateProvider,
      ),
    ).toBe(6);
  });

  it('should keep Sao Paulo unchanged', () => {
    expect(
      inferInstallmentCount(
        {
          startDate: new Date('2099-01-15T03:00:00Z'),
          endDate: new Date('2099-06-15T03:00:00Z'),
          frequency: RecurrenceFrequency.MONTHLY,
          interval: 1,
          timezone: 'America/Sao_Paulo',
        },
        realDateProvider,
      ),
    ).toBe(6);
  });

  it('should return null for an off-grid date in a DST zone', () => {
    expect(
      inferInstallmentCount(
        {
          startDate: new Date('2099-03-02T05:00:00Z'),
          endDate: new Date('2099-03-24T04:00:00Z'),
          frequency: RecurrenceFrequency.WEEKLY,
          interval: 1,
          timezone: 'America/New_York',
        },
        realDateProvider,
      ),
    ).toBeNull();
  });
});

describe('nextOccurrence parity with CalculateNextGenerationDateService', () => {
  const realDateProvider = new DayJsDateProvider();
  const calculator = new CalculateNextGenerationDateService(realDateProvider);

  function nextByCalculator(startDate: Date, overrides = {}) {
    const input = schedule({
      timezone: DEFAULT_TIMEZONE,
      ...overrides,
    });
    return calculator.execute({
      ...input,
      anchorDate: startDate,
      baseDate: startDate,
    });
  }

  function nextByHelper(startDate: Date, overrides = {}) {
    return nextOccurrence(
      schedule({
        startDate,
        timezone: DEFAULT_TIMEZONE,
        ...overrides,
      }),
      realDateProvider,
    );
  }

  it.each([1, 2])('should match for weekly interval %i', (interval) => {
    const startDate = new Date('2099-01-15T03:00:00Z');
    const overrides = { frequency: RecurrenceFrequency.WEEKLY, interval };

    expect(nextByHelper(startDate, overrides)).toEqual(
      nextByCalculator(startDate, overrides),
    );
  });

  it('should match for monthly steps anchored on Jan 31', () => {
    const anchorDate = new Date('2099-01-31T12:00:00Z');
    const input = schedule({
      startDate: anchorDate,
      frequency: RecurrenceFrequency.MONTHLY,
      timezone: DEFAULT_TIMEZONE,
    });
    let baseDate = anchorDate;

    for (let step = 0; step < 3; step++) {
      const helperDate = nextOccurrenceAfter(input, baseDate, realDateProvider);
      expect(helperDate).toEqual(
        calculator.execute({ ...input, anchorDate, baseDate }),
      );
      baseDate = helperDate;
    }
  });

  it('should match for yearly from Feb 29 2028', () => {
    const startDate = new Date('2028-02-29T03:00:00Z');
    const overrides = { frequency: RecurrenceFrequency.YEARLY };

    expect(nextByHelper(startDate, overrides)).toEqual(
      nextByCalculator(startDate, overrides),
    );
  });
});

describe('isPlanExhaustedBefore', () => {
  const realDateProvider = new DayJsDateProvider();
  const startDate = realDateProvider.startOfDay('2026-01-10', DEFAULT_TIMEZONE);

  function plan(overrides: Record<string, unknown> = {}) {
    return {
      startDate,
      frequency: RecurrenceFrequency.MONTHLY,
      interval: 1,
      timezone: DEFAULT_TIMEZONE,
      installmentCount: null,
      endDate: null,
      ...overrides,
    };
  }

  it('should keep the last parcel day inside the plan', () => {
    const installmentPlan = plan({ installmentCount: 3 });

    expect(
      isPlanExhaustedBefore(
        installmentPlan,
        realDateProvider.startOfDay('2026-03-10', DEFAULT_TIMEZONE),
        realDateProvider,
      ),
    ).toBe(false);
    expect(
      isPlanExhaustedBefore(
        installmentPlan,
        realDateProvider.startOfDay('2026-03-11', DEFAULT_TIMEZONE),
        realDateProvider,
      ),
    ).toBe(true);
  });

  it('should treat the endDate day as the last day of the plan', () => {
    const endDatePlan = plan({
      installmentCount: null,
      endDate: realDateProvider.startOfDay('2026-03-10', DEFAULT_TIMEZONE),
    });

    expect(
      isPlanExhaustedBefore(
        endDatePlan,
        realDateProvider.startOfDay('2026-03-10', DEFAULT_TIMEZONE),
        realDateProvider,
      ),
    ).toBe(false);
    expect(
      isPlanExhaustedBefore(
        endDatePlan,
        realDateProvider.startOfDay('2026-03-11', DEFAULT_TIMEZONE),
        realDateProvider,
      ),
    ).toBe(true);
  });

  it('should never exhaust a plan without endDate or installment count', () => {
    expect(
      isPlanExhaustedBefore(
        plan(),
        realDateProvider.startOfDay('2099-12-31', DEFAULT_TIMEZONE),
        realDateProvider,
      ),
    ).toBe(false);
  });
});
