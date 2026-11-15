import { RecurrenceFrequency } from '@constants/enums';
import { RECURRING_GENERATION_TIMEZONE } from '@constants/timezone';
import { UnknownRecurrenceFrequencyError } from '@modules/transaction/errors';
import { CalculateNextGenerationDateService } from '@modules/transaction/services/calculate-next-generation-date.service';
import { DayJsDateProvider } from '@providers/date/implementations/Dayjs';

const service = new CalculateNextGenerationDateService(new DayJsDateProvider());

const request = (overrides: Record<string, unknown> = {}) => ({
  anchorDate: new Date('2026-01-31T12:00:00.000Z'),
  baseDate: new Date('2026-02-28T12:00:00.000Z'),
  frequency: RecurrenceFrequency.MONTHLY,
  interval: 1,
  timezone: RECURRING_GENERATION_TIMEZONE,
  ...overrides,
});

describe('CalculateNextGenerationDateService', () => {
  it('returns the anchor day after a clamped February', () => {
    expect(service.execute(request())).toEqual(
      new Date('2026-03-31T12:00:00.000Z'),
    );
  });

  it('clamps to the last day of a short month', () => {
    expect(
      service.execute(
        request({ baseDate: new Date('2026-03-31T12:00:00.000Z') }),
      ),
    ).toEqual(new Date('2026-04-30T12:00:00.000Z'));
  });

  it('returns the leap day again after a clamped yearly step', () => {
    expect(
      service.execute(
        request({
          anchorDate: new Date('2024-02-29T12:00:00.000Z'),
          baseDate: new Date('2027-02-28T12:00:00.000Z'),
          frequency: RecurrenceFrequency.YEARLY,
        }),
      ),
    ).toEqual(new Date('2028-02-29T12:00:00.000Z'));
  });

  it('honors the interval on the anchor grid', () => {
    expect(
      service.execute(
        request({
          baseDate: new Date('2026-03-31T12:00:00.000Z'),
          interval: 2,
        }),
      ),
    ).toEqual(new Date('2026-05-31T12:00:00.000Z'));
  });

  it('returns the first occurrence after the base date, never the base', () => {
    expect(
      service
        .execute(request({ baseDate: new Date('2026-03-31T12:00:00.000Z') }))
        .getTime(),
    ).toBeGreaterThan(new Date('2026-03-31T12:00:00.000Z').getTime());
  });

  it('throws the named error for an unknown frequency', () => {
    expect(() => service.execute(request({ frequency: 'DAILY' }))).toThrow(
      UnknownRecurrenceFrequencyError,
    );
  });
});
